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
const RESET = "\x1b[0m";

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function openBrowser(url: string): void {
  const { execSync } = require("node:child_process");
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
    output: process.stderr, // prompts go to stderr, not stdout
    terminal: true,
  });

  const envPath = getEnvPath();

  console.error("");
  console.error(`  ${BOLD}gwrk setup slack${RESET}`);
  console.error(`  ${DIM}Connect gwrk to your Slack workspace${RESET}`);
  console.error("");

  // Step 1: Check if user has a Slack app
  console.error(`  ${CYAN}Step 1${RESET}  Create a Slack App`);
  console.error(`  ${DIM}You need a Slack app with Socket Mode enabled.${RESET}`);
  console.error("");

  const hasApp = await ask(rl, `  ${BOLD}Do you already have a Slack app? ${DIM}(y/N)${RESET} `);

  if (!hasApp || hasApp.toLowerCase() !== "y") {
    console.error("");
    console.error(`  ${YELLOW}→${RESET} Opening ${BOLD}https://api.slack.com/apps${RESET} ...`);
    openBrowser("https://api.slack.com/apps");
    console.error("");
    console.error(`  ${DIM}Create a new app "From scratch", then:${RESET}`);
    console.error(`    1. ${BOLD}Socket Mode${RESET} → Enable → Generate App Token ${DIM}(scope: connections:write)${RESET}`);
    console.error(`    2. ${BOLD}OAuth & Permissions${RESET} → Add Bot Scopes:`);
    console.error(`       ${DIM}chat:write, channels:read, commands, app_mentions:read, users:read${RESET}`);
    console.error(`    3. ${BOLD}Install to Workspace${RESET} → Copy Bot User OAuth Token`);
    console.error("");
    await ask(rl, `  ${BOLD}Press Enter when ready...${RESET}`);
  }

  // Step 2: Collect Bot Token
  console.error("");
  console.error(`  ${CYAN}Step 2${RESET}  Bot Token ${DIM}(starts with xoxb-)${RESET}`);
  console.error(`  ${DIM}Found at: OAuth & Permissions → Bot User OAuth Token${RESET}`);
  console.error("");

  let botToken = "";
  while (!botToken.startsWith("xoxb-")) {
    botToken = await ask(rl, `  ${BOLD}SLACK_BOT_TOKEN:${RESET} `);
    if (!botToken.startsWith("xoxb-")) {
      console.error(`  ${RED}✗${RESET} Token must start with ${BOLD}xoxb-${RESET}. Try again.`);
    }
  }

  // Step 3: Collect App Token
  console.error("");
  console.error(`  ${CYAN}Step 3${RESET}  App Token ${DIM}(starts with xapp-)${RESET}`);
  console.error(`  ${DIM}Found at: Basic Information → App-Level Tokens${RESET}`);
  console.error("");

  let appToken = "";
  while (!appToken.startsWith("xapp-")) {
    appToken = await ask(rl, `  ${BOLD}SLACK_APP_TOKEN:${RESET} `);
    if (!appToken.startsWith("xapp-")) {
      console.error(`  ${RED}✗${RESET} Token must start with ${BOLD}xapp-${RESET}. Try again.`);
    }
  }

  rl.close();

  // Step 4: Verify
  console.error("");
  console.error(`  ${CYAN}Step 4${RESET}  Verifying connection...`);

  try {
    const result = await verifySlackConfig({ botToken, appToken });

    // Step 5: Write tokens
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
    console.error(`  ${GREEN}✓${RESET} Connected to workspace: ${BOLD}${result.workspace}${RESET}`);
    console.error(`  ${GREEN}✓${RESET} Tokens saved to ${DIM}${envPath}${RESET}`);
    console.error(`  ${GREEN}✓${RESET} Socket Mode: OK`);
    console.error("");
    console.error(`  ${DIM}Re-verify anytime: ${BOLD}gwrk setup slack --verify${RESET}`);
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
