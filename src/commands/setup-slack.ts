import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { Command } from "commander";
import {
  type SlackSetupResult,
  getEnvPath,
  loadSlackConfig,
  verifySlackConfig,
} from "../utils/slack-client.js";

// ── ANSI helpers ──────────────────────────────────────
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const RESET = "\x1b[0m";

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
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: true,
  });

  const envPath = getEnvPath();

  console.error("");
  console.error(`  ${MAGENTA}${BOLD}gwrk${RESET} ${DIM}setup slack${RESET}`);
  console.error(`  ${DIM}Connect gwrk to your Slack workspace${RESET}`);
  console.error("");
  console.error(`  This will create a Slack app named ${MAGENTA}${BOLD}gwrk${RESET} with:`);
  console.error("    • Socket Mode for real-time events");
  console.error(`    • ${BOLD}/gwrk${RESET} slash command with subcommands`);
  console.error("    • App Home dashboard tab");
  console.error("    • Interactive buttons (approve/reject)");
  console.error("    • Event subscriptions (mentions, home tab)");
  console.error("");

  // ── Step 1: Create App from Manifest ────────────
  console.error(`  ${CYAN}Step 1 of 3${RESET}  Create the Slack App`);
  console.error("");

  const hasApp = await ask(rl, `  Do you already have a gwrk Slack app? ${DIM}(y/N)${RESET} `);

  if (!hasApp || hasApp.toLowerCase() !== "y") {
    console.error("");
    console.error(`  ${YELLOW}→${RESET} Opening Slack API...`);
    openBrowser("https://api.slack.com/apps?new_app=1");
    console.error("");
    const manifestPath = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      "..",
      "slack-manifest.yml",
    );

    console.error(`  In the dialog that appears, choose ${BOLD}"From a manifest"${RESET}.`);
    console.error(`  Select your workspace and click ${BOLD}Next${RESET}.`);
    console.error(`  Switch to the ${BOLD}YAML${RESET} tab, then paste the gwrk manifest.`);
    console.error("");
    console.error(`  ${BOLD}Option A${RESET} — Copy to clipboard and paste:`);
    console.error("");
    console.error(`    ${CYAN}cat ${manifestPath} | pbcopy${RESET}`);
    console.error("");
    console.error(`  ${BOLD}Option B${RESET} — Open the file yourself:`);
    console.error("");
    console.error(`    ${DIM}${manifestPath}${RESET}`);
    console.error("");
    console.error(`  Click ${BOLD}Next${RESET}, review the summary, then click ${BOLD}Create${RESET}.`);
    console.error("");
    await ask(rl, "  Press Enter when your app is created... ");
    console.error(`  ${GREEN}✓${RESET} App created`);
  }

  // ── Step 2: Generate App Token ──────────────────
  console.error("");
  console.error(`  ${CYAN}Step 2 of 3${RESET}  Generate App-Level Token`);
  console.error("");
  console.error(`  You should now be on the ${BOLD}Basic Information${RESET} page.`);
  console.error(`  Scroll down to ${BOLD}"App-Level Tokens"${RESET} and click`);
  console.error(`  ${BOLD}"Generate Token and Scopes"${RESET}.`);
  console.error("");
  console.error(`  In the dialog:`);
  console.error(`    • Token Name: ${BOLD}gwrk-token${RESET}`);
  console.error(`    • The ${BOLD}connections:write${RESET} scope is already added.`);
  console.error(`      ${DIM}(This is the only scope needed — ignore the others.)${RESET}`);
  console.error(`    • Click ${BOLD}Generate${RESET}.`);
  console.error("");
  console.error(`  ${BOLD}Copy the token that appears.${RESET} It starts with ${BOLD}xapp-${RESET}`);
  console.error(`  ${DIM}(You can always find it later under App-Level Tokens.)${RESET}`);
  console.error("");

  let appToken = "";
  while (!appToken.startsWith("xapp-")) {
    appToken = await ask(rl, `  ${BOLD}Paste your App Token here:${RESET} `);
    if (!appToken.startsWith("xapp-")) {
      console.error(`  ${RED}✗${RESET} That doesn't look right — it should start with ${BOLD}xapp-${RESET}`);
      console.error(`  ${DIM}Look under Basic Information → App-Level Tokens${RESET}`);
    }
  }
  console.error(`  ${GREEN}✓${RESET} App Token saved`);

  // ── Step 3: Install & Get Bot Token ─────────────
  console.error("");
  console.error(`  ${CYAN}Step 3 of 3${RESET}  Install to Workspace`);
  console.error("");
  console.error(`  In the sidebar, click ${BOLD}Install App${RESET} (under Settings).`);
  console.error(`  Click ${BOLD}"Install to Workspace"${RESET} → ${BOLD}"Allow"${RESET}.`);
  console.error("");
  console.error(`  ${BOLD}Copy the "Bot User OAuth Token"${RESET} that appears.`);
  console.error(`  It starts with ${BOLD}xoxb-${RESET}`);
  console.error("");

  let botToken = "";
  while (!botToken.startsWith("xoxb-")) {
    botToken = await ask(rl, `  ${BOLD}Paste your Bot Token here:${RESET} `);
    if (!botToken.startsWith("xoxb-")) {
      console.error(`  ${RED}✗${RESET} That doesn't look right — it should start with ${BOLD}xoxb-${RESET}`);
      console.error(`  ${DIM}Look under Install App → Bot User OAuth Token${RESET}`);
    }
  }
  console.error(`  ${GREEN}✓${RESET} Bot Token saved`);

  rl.close();

  // ── Verify & Save ──────────────────────────────
  console.error("");
  console.error(`  ${DIM}Verifying connection...${RESET}`);

  try {
    const result = await verifySlackConfig({ botToken, appToken });

    const envDir = path.dirname(envPath);
    if (!fs.existsSync(envDir)) {
      fs.mkdirSync(envDir, { recursive: true });
    }

    let envContent = "";
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, "utf-8");
    }

    const lines = envContent.split("\n");
    const newLines = lines.filter(
      (line) =>
        !line.startsWith("SLACK_BOT_TOKEN=") &&
        !line.startsWith("SLACK_APP_TOKEN="),
    );
    newLines.push(`SLACK_BOT_TOKEN=${botToken}`);
    newLines.push(`SLACK_APP_TOKEN=${appToken}`);

    fs.writeFileSync(envPath, `${newLines.join("\n").trim()}\n`, {
      mode: 0o600,
    });

    console.error("");
    console.error(`  ${GREEN}┌──────────────────────────────────────────────┐${RESET}`);
    console.error(`  ${GREEN}│${RESET}  ${GREEN}✓${RESET} ${BOLD}gwrk is connected to Slack${RESET}                ${GREEN}│${RESET}`);
    console.error(`  ${GREEN}│${RESET}                                              ${GREEN}│${RESET}`);
    console.error(`  ${GREEN}│${RESET}  Workspace:  ${BOLD}${result.workspace}${RESET}`);
    console.error(`  ${GREEN}│${RESET}  Tokens:     ${DIM}${envPath}${RESET}`);
    console.error(`  ${GREEN}│${RESET}  Socket:     ${GREEN}OK${RESET}`);
    console.error(`  ${GREEN}│${RESET}                                              ${GREEN}│${RESET}`);
    console.error(`  ${GREEN}│${RESET}  ${DIM}Re-verify: gwrk setup slack --verify${RESET}       ${GREEN}│${RESET}`);
    console.error(`  ${GREEN}└──────────────────────────────────────────────┘${RESET}`);
    console.error("");

    return {
      workspace: result.workspace,
      tokensWritten: true,
      socketModeOk: true,
      alreadyConfigured: false,
    };
  } catch (error) {
    console.error("");
    console.error(`  ${RED}✗${RESET} Verification failed: ${(error as Error).message}`);
    console.error("");
    console.error(`  ${DIM}Check your tokens and try again:${RESET}`);
    console.error(`    ${BOLD}gwrk setup slack${RESET}`);
    console.error("");
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
      console.error(`  ${GREEN}✓${RESET} Slack already configured for workspace: ${BOLD}${result.workspace}${RESET}`);
      console.error(`  ${DIM}Run with --verify for full check${RESET}`);
      return {
        workspace: result.workspace,
        tokensWritten: false,
        socketModeOk: true,
        alreadyConfigured: true,
      };
    } catch {
      console.error(`  ${YELLOW}⚠${RESET} Saved tokens are invalid. Re-running setup...`);
      console.error("");
      return interactiveSetup();
    }
  }

  // Verify mode with existing config
  if (existingConfig && opts.verify) {
    try {
      const result = await verifySlackConfig(existingConfig);
      console.error(`  ${GREEN}✓${RESET} Bot Token: OK`);
      console.error(`  ${GREEN}✓${RESET} App Token: OK`);
      console.error(`  ${GREEN}✓${RESET} Socket Mode: OK`);
      console.error(`  ${GREEN}✓${RESET} Workspace: ${BOLD}${result.workspace}${RESET}`);
      return {
        workspace: result.workspace,
        tokensWritten: false,
        socketModeOk: true,
        alreadyConfigured: true,
      };
    } catch (error) {
      console.error(`  ${RED}✗${RESET} Socket Mode: FAIL`);
      console.error(`  ${RED}✗${RESET} ${(error as Error).message}`);
      console.error("");
      console.error(`  ${DIM}Re-run setup: ${BOLD}gwrk setup slack${RESET}`);
      process.exit(1);
    }
  }

  // Check if tokens were passed as env vars (non-interactive CI mode)
  const envBot = process.env.SLACK_BOT_TOKEN;
  const envApp = process.env.SLACK_APP_TOKEN;
  if (envBot?.startsWith("xoxb-") && envApp?.startsWith("xapp-")) {
    try {
      const result = await verifySlackConfig({ botToken: envBot, appToken: envApp });
      const envPath = getEnvPath();
      const envDir = path.dirname(envPath);
      if (!fs.existsSync(envDir)) {
        fs.mkdirSync(envDir, { recursive: true });
      }
      let envContent = "";
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, "utf-8");
      }
      const lines = envContent.split("\n").filter(
        (l) => !l.startsWith("SLACK_BOT_TOKEN=") && !l.startsWith("SLACK_APP_TOKEN="),
      );
      lines.push(`SLACK_BOT_TOKEN=${envBot}`);
      lines.push(`SLACK_APP_TOKEN=${envApp}`);
      fs.writeFileSync(envPath, `${lines.join("\n").trim()}\n`, { mode: 0o600 });

      console.error(`  ${GREEN}✓${RESET} Connected to workspace: ${BOLD}${result.workspace}${RESET}`);
      console.error(`  ${GREEN}✓${RESET} Tokens saved to ${DIM}${envPath}${RESET}`);
      return {
        workspace: result.workspace,
        tokensWritten: true,
        socketModeOk: true,
        alreadyConfigured: false,
      };
    } catch (error) {
      console.error(`  ${RED}✗${RESET} Env var tokens are invalid: ${(error as Error).message}`);
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
