import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface, type Interface } from "node:readline";
import { Command } from "commander";
import { banner, color, fail, success } from "../utils/format.js";
import {
  loadSetupState,
  saveSetupState,
} from "../utils/setup-state.js";
import { CommandError, withSignal } from "../utils/signal.js";

const { BOLD, DIM, GREEN, YELLOW, RED, CYAN, RESET } = color;

function ask(rl: Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

/**
 * gwrk setup — Interactive workstation provisioning
 */
export const setupCommand = new Command("setup")
  .description(
    "Interactively configure macOS workstation for unattended agent execution",
  )
  .action(async () => {
    await withSignal("setup", async () => {
      if (!process.stdin.isTTY) {
        throw new CommandError(
          "Setup must be run in an interactive terminal.",
          1,
        );
      }

      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const startTime = Date.now();

      try {
        const state = loadSetupState() || {
          steps: { tcc: false, ssh: false, gh: false, verification: false },
        };

        banner("workstation setup", { OS: "macOS" });

        // Step 1: TCC
        if (!state.steps.tcc) {
          console.log(`\n  ${CYAN}Step 1: macOS TCC Permissions${RESET}`);
          console.log(
            "  Agents need Full Disk Access to operate without prompts.",
          );
          console.log(
            `  Please open ${BOLD}System Settings → Privacy & Security → Full Disk Access${RESET}`,
          );
          console.log("  Ensure your Terminal/IDE is enabled.");

          const done = await ask(
            rl,
            `  Have you granted Full Disk Access? ${DIM}(y/N)${RESET} `,
          );
          if (done.toLowerCase() === "y") {
            state.steps.tcc = true;
            saveSetupState(state);
          }
        } else {
          console.log(
            `  ${GREEN}✓${RESET} Step 1: TCC Permissions already configured.`,
          );
        }

        // Step 2: SSH
        if (!state.steps.ssh) {
          console.log(
            `\n  ${CYAN}Step 2: Dedicated SSH Key (Bypass 1Password)${RESET}`,
          );
          console.log("  How would you like to configure SSH?");
          console.log(`  ${BOLD}A)${RESET} Use 1Password (SSH_AUTH_SOCK)`);
          console.log(
            `  ${BOLD}B)${RESET} Dedicated key (~/.ssh/gwrk-agent, no passphrase) ${DIM}[DEFAULT]${RESET}`,
          );
          console.log(`  ${BOLD}S)${RESET} Skip (Already configured)`);

          const choice = (await ask(rl, `  Choice? ${DIM}(a/B/s)${RESET} `)) || "b";

          if (choice.toLowerCase() === "a") {
            console.log("  Configuring to use 1Password...");
            const sshDir = path.join(os.homedir(), ".ssh");
            const configPath = path.join(sshDir, "config");
            if (!fs.existsSync(sshDir)) fs.mkdirSync(sshDir, { mode: 0o700 });
            
            const entry = `\n# gwrk agent — use 1Password\nHost github.com\n  IdentityAgent "~/Library/Group Containers/2BU85C4YRE.com.1password/t/agent.sock"\n`;
            fs.appendFileSync(configPath, entry);
            state.steps.ssh = true;
            saveSetupState(state);
          } else if (choice.toLowerCase() === "b") {
            const sshDir = path.join(os.homedir(), ".ssh");
            const keyPath = path.join(sshDir, "gwrk-agent");
            const configPath = path.join(sshDir, "config");

            if (!fs.existsSync(sshDir)) {
              fs.mkdirSync(sshDir, { mode: 0o700 });
            }

            if (!fs.existsSync(keyPath)) {
              console.log(
                `  Generating dedicated key: ${DIM}${keyPath}${RESET}`,
              );
              execSync(
                `ssh-keygen -t ed25519 -f "${keyPath}" -N "" -C "gwrk-agent@$(hostname)"`,
                { stdio: "inherit" },
              );
            }

            const sshConfig = fs.existsSync(configPath)
              ? fs.readFileSync(configPath, "utf-8")
              : "";
            if (
              !sshConfig.includes("Host github.com") ||
              !sshConfig.includes("IdentityFile ~/.ssh/gwrk-agent")
            ) {
              console.log(`  Updating ${DIM}~/.ssh/config${RESET}...`);
              const entry = `\n# gwrk agent key — bypasses 1Password for GitHub\nHost github.com\n  IdentityFile ~/.ssh/gwrk-agent\n  IdentityAgent none\n`;
              fs.appendFileSync(configPath, entry);
            }

            console.log("  Please add this public key to your GitHub account:");
            console.log(
              `  ${BOLD}gh ssh-key add "${keyPath}.pub" --title "gwrk-agent-$(hostname)"${RESET}`,
            );

            const done = await ask(
              rl,
              `  Have you added the key to GitHub? ${DIM}(y/N)${RESET} `,
            );
            if (done.toLowerCase() === "y") {
              state.steps.ssh = true;
              saveSetupState(state);
            }
          } else if (choice.toLowerCase() === "s") {
            console.log("  Skipping SSH configuration.");
            state.steps.ssh = true;
            saveSetupState(state);
          }
        } else {
          console.log(`  ${GREEN}✓${RESET} Step 2: SSH Key already configured.`);
        }

        // Step 3: GH Auth
        if (!state.steps.gh) {
          console.log(`\n  ${CYAN}Step 3: GitHub CLI Authentication${RESET}`);
          try {
            execSync("gh auth status", { stdio: "ignore" });
            state.steps.gh = true;
            saveSetupState(state);
            console.log(`  ${GREEN}✓${RESET} GitHub CLI is authenticated.`);
          } catch {
            console.log("  GitHub CLI is not authenticated.");
            console.log(
              `  Please run: ${BOLD}gh auth login --git-protocol ssh${RESET}`,
            );
            const done = await ask(
              rl,
              `  Have you authenticated gh? ${DIM}(y/N)${RESET} `,
            );
            if (done.toLowerCase() === "y") {
              state.steps.gh = true;
              saveSetupState(state);
            }
          }
        } else {
          console.log(`  ${GREEN}✓${RESET} Step 3: GH CLI already configured.`);
        }

        // Step 4: Verification
        console.log(`\n  ${CYAN}Step 4: Final Verification${RESET}`);
        let allOk = true;

        // 1. Filesystem
        try {
          execSync("ls ~/Desktop > /dev/null", { stdio: "ignore" });
          console.log(`  ${GREEN}✓${RESET} TCC/Filesystem: OK`);
        } catch {
          console.log(
            `  ${RED}✗${RESET} TCC/Filesystem: FAILED (Check Full Disk Access)`,
          );
          allOk = false;
        }

        // 2. SSH
        try {
          // Use -o BatchMode=yes to avoid hang if passphrase needed or something
          const sshOut = execSync(
            "ssh -T -o BatchMode=yes git@github.com 2>&1",
            { encoding: "utf-8" },
          );
          if (sshOut.includes("successfully authenticated")) {
            console.log(`  ${GREEN}✓${RESET} SSH: OK`);
          } else {
            console.log(`  ${RED}✗${RESET} SSH: FAILED`);
            allOk = false;
          }
        } catch (err: any) {
          const out = (err.stdout || "") + (err.stderr || "");
          if (out.includes("successfully authenticated")) {
            console.log(`  ${GREEN}✓${RESET} SSH: OK`);
          } else {
            console.log(`  ${RED}✗${RESET} SSH: FAILED`);
            allOk = false;
          }
        }

        // 3. GH
        try {
          execSync("gh api user", { stdio: "ignore" });
          console.log(`  ${GREEN}✓${RESET} GH API: OK`);
        } catch {
          console.log(`  ${RED}✗${RESET} GH API: FAILED`);
          allOk = false;
        }

        const durationS = Math.round((Date.now() - startTime) / 1000);

        if (allOk) {
          state.steps.verification = true;
          state.completedAt = new Date().toISOString();
          saveSetupState(state);
          success("setup", durationS);
          console.log(
            `\n  ${GREEN}${BOLD}Workstation is ready for autonomous operations!${RESET}`,
          );
        } else {
          state.steps.verification = false;
          saveSetupState(state);
          fail("setup", 1, durationS);
          console.log(
            `\n  ${YELLOW}Please fix the failing checks and run 'gwrk setup' again.${RESET}`,
          );
        }
      } finally {
        if (rl) rl.close();
      }
    });
  });

