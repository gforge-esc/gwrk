import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { Command } from "commander";
import { banner, color, fail, success } from "../utils/format.js";
import {
  type SlackSetupResult,
  getEnvPath,
  loadSlackConfig,
  verifySlackConfig,
} from "../utils/slack-client.js";

const { BOLD, DIM, GREEN, YELLOW, RED, CYAN, MAGENTA, RESET } = color;

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function openBrowser(url: string): void {
  try {
    execSync(`open "${url}"`, { stdio: "ignore" });
  } catch {
    // silently fail — user can open manually
  }
}

// ── Interactive setup flow ────────────────────────────
async function interactiveSetup(): Promise<SlackSetupResult> {
  if (!process.stdin.isTTY) {
    console.error(
      `  ${RED}✗${RESET} Slack credentials not found and terminal is non-interactive.`,
    );
    console.error(
      `  ${DIM}Provide SLACK_BOT_TOKEN and SLACK_APP_TOKEN in environment.${RESET}`,
    );
    process.exit(1);
    return null as any;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: true,
  });

  const envPath = getEnvPath();

  banner("setup slack", { Mode: "Interactive" });
  console.error(`  ${DIM}Connect gwrk to your Slack workspace${RESET}`);
  console.error("");
  console.error(
    `  This will create a Slack app named ${MAGENTA}${BOLD}gwrk${RESET} with:`,
  );
  console.error("    • Socket Mode for real-time events");
  console.error(`    • ${BOLD}/gwrk${RESET} slash command with subcommands`);
  console.error("    • App Home dashboard tab");
  console.error("");

  // ── Step 1: Create App from Manifest ────────────
  console.error(`  ${CYAN}Step 1 of 3${RESET}  Create the Slack App`);
  console.error("");

  const hasApp = await ask(
    rl,
    `  Do you already have a gwrk Slack app? ${DIM}(y/N)${RESET} `,
  );

  if (!hasApp || hasApp.toLowerCase() !== "y") {
    console.error("");
    console.error(`  ${YELLOW}→${RESET} Opening Slack API...`);
    openBrowser("https://api.slack.com/apps?new_app=1");
    console.error("");

    // In ESM, __dirname is not available. Use this instead:
    const manifestPath = path.resolve(
      process.cwd(),
      "src",
      "slack-manifest.yml",
    );

    console.error(
      `  In the dialog that appears, choose ${BOLD}"From a manifest"${RESET}.`,
    );
    console.error(`  Select your workspace and click ${BOLD}Next${RESET}.`);
    console.error(
      `  Switch to the ${BOLD}YAML${RESET} tab, then paste the gwrk manifest.`,
    );
    console.error("");
    console.error(`  ${BOLD}Option A${RESET} — Copy to clipboard and paste:`);
    console.error("");
    console.error(`    ${CYAN}cat ${manifestPath} | pbcopy${RESET}`);
    console.error("");
    console.error(`  ${BOLD}Option B${RESET} — Open the file yourself:`);
    console.error("");
    console.error(`    ${DIM}${manifestPath}${RESET}`);
    console.error("");
    await ask(rl, "  Press Enter when your app is created... ");
    console.error(`  ${GREEN}✓${RESET} App created`);
  }

  // ── Step 2: Generate App Token ──────────────────
  console.error("");
  console.error(`  ${CYAN}Step 2 of 3${RESET}  Generate App-Level Token`);
  console.error("");
  let appToken = "";
  while (!appToken.startsWith("xapp-")) {
    appToken = await ask(
      rl,
      `  ${BOLD}Paste your App Token (xapp-...) here:${RESET} `,
    );
  }
  console.error(`  ${GREEN}✓${RESET} App Token saved`);

  // ── Step 3: Install & Get Bot Token ─────────────
  console.error("");
  console.error(`  ${CYAN}Step 3 of 3${RESET}  Install to Workspace`);
  console.error("");
  let botToken = "";
  while (!botToken.startsWith("xoxb-")) {
    botToken = await ask(
      rl,
      `  ${BOLD}Paste your Bot Token (xoxb-...) here:${RESET} `,
    );
  }
  console.error(`  ${GREEN}✓${RESET} Bot Token saved`);

  rl.close();

  // ── Verify & Save ──────────────────────────────
  try {
    const result = await verifySlackConfig({ botToken, appToken });

    const envDir = path.dirname(envPath);
    if (!fs.existsSync(envDir)) fs.mkdirSync(envDir, { recursive: true });

    let envContent = "";
    if (fs.existsSync(envPath)) envContent = fs.readFileSync(envPath, "utf-8");

    const lines = envContent
      .split("\n")
      .filter(
        (l) =>
          !l.startsWith("SLACK_BOT_TOKEN=") &&
          !l.startsWith("SLACK_APP_TOKEN="),
      );
    lines.push(`SLACK_BOT_TOKEN=${botToken}`);
    lines.push(`SLACK_APP_TOKEN=${appToken}`);

    fs.writeFileSync(envPath, `${lines.join("\n").trim()}\n`, { mode: 0o600 });

    console.log(`Slack app configured for workspace: ${result.workspace}`);
    success("setup slack", 0);

    return {
      workspace: result.workspace,
      tokensWritten: true,
      socketModeOk: true,
      alreadyConfigured: false,
    };
  } catch (error) {
    fail("setup slack", 1, 0);
    console.error(
      `  ${RED}✗${RESET} Verification failed: ${(error as Error).message}`,
    );
    process.exit(1);
  }
}

// ── Main entry point ──────────────────────────────────
export async function setupSlack(opts: {
  verify?: boolean;
}): Promise<SlackSetupResult> {
  const existingConfig = loadSlackConfig();

  // Already configured and not verifying — just report
  if (existingConfig && !opts.verify) {
    try {
      const result = await verifySlackConfig(existingConfig);
      console.log("Slack already configured");
      console.error(`  ${DIM}Workspace: ${result.workspace}${RESET}`);
      return {
        workspace: result.workspace,
        tokensWritten: false,
        socketModeOk: true,
        alreadyConfigured: true,
      };
    } catch {
      console.error(
        `  ${YELLOW}⚠${RESET} Saved tokens are invalid. Re-running setup...`,
      );
      return interactiveSetup();
    }
  }

  // Verify mode with existing config
  if (existingConfig && opts.verify) {
    try {
      const result = await verifySlackConfig(existingConfig);
      console.log("Socket Mode: OK");
      console.error(`  ${DIM}Workspace: ${result.workspace}${RESET}`);
      return {
        workspace: result.workspace,
        tokensWritten: false,
        socketModeOk: true,
        alreadyConfigured: true,
      };
    } catch (error) {
      fail("setup slack", 1, 0);
      console.error(
        `  ${RED}✗${RESET} Socket Mode: FAIL - ${(error as Error).message}`,
      );
      process.exit(1);
    }
  }

  // Check if tokens were passed as env vars (non-interactive CI mode)
  const envBot = process.env.SLACK_BOT_TOKEN;
  const envApp = process.env.SLACK_APP_TOKEN;
  if (envBot?.startsWith("xoxb-") && envApp?.startsWith("xapp-")) {
    try {
      const result = await verifySlackConfig({
        botToken: envBot,
        appToken: envApp,
      });
      const envPath = getEnvPath();
      const envDir = path.dirname(envPath);
      if (!fs.existsSync(envDir)) fs.mkdirSync(envDir, { recursive: true });

      let envContent = "";
      if (fs.existsSync(envPath))
        envContent = fs.readFileSync(envPath, "utf-8");

      const lines = envContent
        .split("\n")
        .filter(
          (l) =>
            !l.startsWith("SLACK_BOT_TOKEN=") &&
            !l.startsWith("SLACK_APP_TOKEN="),
        );
      lines.push(`SLACK_BOT_TOKEN=${envBot}`);
      lines.push(`SLACK_APP_TOKEN=${envApp}`);
      fs.writeFileSync(envPath, `${lines.join("\n").trim()}\n`, {
        mode: 0o600,
      });

      console.log(`Slack app configured for workspace: ${result.workspace}`);
      return {
        workspace: result.workspace,
        tokensWritten: true,
        socketModeOk: true,
        alreadyConfigured: false,
      };
    } catch (error) {
      fail("setup slack", 1, 0);
      console.error(
        `  ${RED}✗${RESET} Env tokens invalid: ${(error as Error).message}`,
      );
      process.exit(1);
    }
  }

  // No config, no env vars — interactive setup
  return interactiveSetup();
}

export const setupSlackCommand = new Command("slack")
  .description("Setup Slack integration")
  .option("--verify", "Verify existing Slack configuration")
  .action(async (options) => {
    await setupSlack(options);
  });
