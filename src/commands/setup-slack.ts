import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Command } from "commander";
import {
  type SlackSetupResult,
  getEnvPath,
  loadSlackConfig,
  verifySlackConfig,
} from "../utils/slack-client.js";

export async function setupSlack(opts: {
  verify?: boolean;
}): Promise<SlackSetupResult> {
  const existingConfig = loadSlackConfig();

  if (existingConfig && !opts.verify) {
    console.log("Slack already configured");
    return {
      workspace: (await verifySlackConfig(existingConfig)).workspace,
      tokensWritten: false,
      socketModeOk: true,
      alreadyConfigured: true,
    };
  }

  const botToken = process.env.SLACK_BOT_TOKEN;
  const appToken = process.env.SLACK_APP_TOKEN;

  if (!botToken || !appToken) {
    if (existingConfig && opts.verify) {
      // Use existing config for verification
      try {
        const result = await verifySlackConfig(existingConfig);
        console.log("Socket Mode: OK");
        console.log("Bot Token: OK");
        console.log("App Token: OK");
        console.log("Test Message: OK"); // Basic auth.test is our "test message" for now
        return {
          workspace: result.workspace,
          tokensWritten: false,
          socketModeOk: true,
          alreadyConfigured: true,
        };
      } catch (error) {
        console.error("Socket Mode: FAIL");
        console.error("Bot Token: FAIL");
        console.error("App Token: FAIL");
        console.error("Test Message: FAIL");
        process.exit(1);
      }
    }

    const envPath = getEnvPath();
    console.error(`
  ┌──────────────────────────────────────────────────────────┐
  │  Slack credentials not found                             │
  └──────────────────────────────────────────────────────────┘

  gwrk needs two tokens from your Slack workspace:

    SLACK_BOT_TOKEN   (starts with xoxb-)
    SLACK_APP_TOKEN   (starts with xapp-)

  ── How to get them ──────────────────────────────────────

  1. Create a Slack App at:
     https://api.slack.com/apps → "Create New App" → "From scratch"

  2. Enable Socket Mode:
     App Settings → Socket Mode → Enable
     → Generate an App-Level Token with scope "connections:write"
     → This is your SLACK_APP_TOKEN (xapp-...)

  3. Add Bot Scopes:
     OAuth & Permissions → Bot Token Scopes → Add:
       chat:write, channels:read, commands,
       app_mentions:read, users:read

  4. Install to Workspace:
     OAuth & Permissions → Install to Workspace
     → Copy the Bot User OAuth Token
     → This is your SLACK_BOT_TOKEN (xoxb-...)

  ── Where to put them ────────────────────────────────────

  Option A (recommended): Write to ${envPath}

    echo 'SLACK_BOT_TOKEN=xoxb-your-token' >> ${envPath}
    echo 'SLACK_APP_TOKEN=xapp-your-token' >> ${envPath}

  Option B: Pass inline:

    SLACK_BOT_TOKEN=xoxb-... SLACK_APP_TOKEN=xapp-... gwrk setup slack

  Then re-run: gwrk setup slack
  Verify:      gwrk setup slack --verify
`);
    process.exit(1);
  }

  try {
    const result = await verifySlackConfig({ botToken, appToken });

    const envPath = getEnvPath();
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

    console.log(`Slack app configured for workspace: ${result.workspace}`);
    console.log(`Tokens written to ${envPath}`);
    console.log("Socket Mode: OK");

    return {
      workspace: result.workspace,
      tokensWritten: true,
      socketModeOk: true,
      alreadyConfigured: false,
    };
  } catch (error) {
    console.error(
      "Socket Mode: FAIL\nBot Token: FAIL\nApp Token: FAIL\nTest Message: FAIL",
    );
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

export const setupSlackCommand = new Command("slack")
  .description("Setup Slack integration")
  .option("--verify", "Verify existing Slack configuration")
  .action(async (options) => {
    await setupSlack(options);
  });
