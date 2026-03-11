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
  console.error(`  ${BOLD}gwrk setup slack${RESET}`);
  console.error(`  ${DIM}Connect gwrk to your Slack workspace${RESET}`);
  console.error("");

  // ── Step 1: Create a Slack App ───────────────────
  console.error(`  ${CYAN}Step 1 of 5${RESET}  Create a Slack App`);
  console.error("");

  const hasApp = await ask(rl, `  Do you already have a Slack app? ${DIM}(y/N)${RESET} `);

  if (!hasApp || hasApp.toLowerCase() !== "y") {
    console.error("");
    console.error(`  ${YELLOW}→${RESET} Opening ${BOLD}https://api.slack.com/apps${RESET}`);
    openBrowser("https://api.slack.com/apps");
    console.error("");
    console.error(`  Click ${BOLD}"Create New App"${RESET} → ${BOLD}"From scratch"${RESET}`);
    console.error(`  Name it anything (e.g. "gwrk") and pick your workspace.`);
    console.error("");
    await ask(rl, "  Press Enter when your app is created... ");
  }

  // ── Step 2: Socket Mode → Collect App Token ──────
  console.error("");
  console.error(`  ${CYAN}Step 2 of 5${RESET}  Enable Socket Mode`);
  console.error("");
  console.error(`  In your app's settings sidebar, click ${BOLD}Socket Mode${RESET}.`);
  console.error(`  Toggle ${BOLD}"Enable Socket Mode"${RESET} to ON.`);
  console.error("");
  console.error(`  A dialog will appear: ${BOLD}"Generate an app-level token"${RESET}`);
  console.error(`  • Token Name: ${DIM}anything (e.g. "gwrk-socket")${RESET}`);
  console.error(`  • Scope ${BOLD}connections:write${RESET} should already be listed.`);
  console.error(`  • Click ${BOLD}Generate${RESET}.`);
  console.error("");
  console.error(`  ${BOLD}Copy the token that appears.${RESET} It starts with ${BOLD}xapp-${RESET}`);
  console.error("");

  let appToken = "";
  while (!appToken.startsWith("xapp-")) {
    appToken = await ask(rl, `  ${BOLD}Paste your App Token here:${RESET} `);
    if (!appToken.startsWith("xapp-")) {
      console.error(`  ${RED}✗${RESET} That doesn't look right — should start with ${BOLD}xapp-${RESET}`);
      console.error(`  ${DIM}Find it at: Settings → Socket Mode → App-Level Tokens${RESET}`);
    }
  }
  console.error(`  ${GREEN}✓${RESET} App Token saved`);

  // ── Step 3: Add Bot Scopes ───────────────────────
  console.error("");
  console.error(`  ${CYAN}Step 3 of 5${RESET}  Add Bot Permissions`);
  console.error("");
  console.error(`  In the sidebar, click ${BOLD}OAuth & Permissions${RESET}.`);
  console.error(`  Scroll to ${BOLD}"Scopes" → "Bot Token Scopes"${RESET} and add:`);
  console.error("");
  console.error(`    ${BOLD}chat:write${RESET}          Send messages`);
  console.error(`    ${BOLD}channels:read${RESET}       List channels`);
  console.error(`    ${BOLD}commands${RESET}            Slash commands`);
  console.error(`    ${BOLD}app_mentions:read${RESET}   Respond to @mentions`);
  console.error(`    ${BOLD}users:read${RESET}          Read user presence`);
  console.error("");
  await ask(rl, "  Press Enter when scopes are added... ");

  // ── Step 4: Install to Workspace → Collect Bot Token
  console.error("");
  console.error(`  ${CYAN}Step 4 of 5${RESET}  Install to Workspace`);
  console.error("");
  console.error(`  Scroll to the top of ${BOLD}OAuth & Permissions${RESET}.`);
  console.error(`  Click ${BOLD}"Install to Workspace"${RESET} → ${BOLD}"Allow"${RESET}.`);
  console.error("");
  console.error(`  ${BOLD}Copy the "Bot User OAuth Token"${RESET} that appears.`);
  console.error(`  It starts with ${BOLD}xoxb-${RESET}`);
  console.error("");

  let botToken = "";
  while (!botToken.startsWith("xoxb-")) {
    botToken = await ask(rl, `  ${BOLD}Paste your Bot Token here:${RESET} `);
    if (!botToken.startsWith("xoxb-")) {
      console.error(`  ${RED}✗${RESET} That doesn't look right — should start with ${BOLD}xoxb-${RESET}`);
      console.error(`  ${DIM}Find it at: OAuth & Permissions → Bot User OAuth Token${RESET}`);
    }
  }
  console.error(`  ${GREEN}✓${RESET} Bot Token saved`);

  rl.close();

  // ── Step 5: Verify ───────────────────────────────
  console.error("");
  console.error(`  ${CYAN}Step 5 of 5${RESET}  Verifying connection...`);

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
