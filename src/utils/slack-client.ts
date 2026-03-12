import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { App } from "@slack/bolt";
import { type SlackConfig, SlackConfigSchema } from "./config.js";

export interface SlackSetupResult {
  workspace: string;
  tokensWritten: boolean;
  socketModeOk: boolean;
  alreadyConfigured: boolean;
}

export function getEnvPath(): string {
  return path.join(os.homedir(), ".gwrk", ".env");
}

export function loadSlackConfig(): SlackConfig | null {
  const envPath = getEnvPath();
  const envVars: Record<string, string> = {};

  // Load from environment first
  if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN) {
    envVars.botToken = process.env.SLACK_BOT_TOKEN;
    envVars.appToken = process.env.SLACK_APP_TOKEN;
  } else if (fs.existsSync(envPath)) {
    // Basic .env parser
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || "";
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        }
        if (key === "SLACK_BOT_TOKEN") envVars.botToken = value;
        if (key === "SLACK_APP_TOKEN") envVars.appToken = value;
      }
    }
  }

  // If no tokens are provided at all, Slack is not configured
  if (!envVars.botToken && !envVars.appToken) {
    return null;
  }

  const result = SlackConfigSchema.safeParse(envVars);
  if (!result.success) {
    console.error(`Slack configuration error: ${result.error.message}`);
    process.exit(1);
  }

  return result.data;
}

export async function verifySlackConfig(config: SlackConfig): Promise<{
  workspace: string;
  socketModeOk: boolean;
}> {
  const app = new App({
    token: config.botToken,
    appToken: config.appToken,
    socketMode: true,
  });

  try {
    const auth = await app.client.auth.test();
    return {
      workspace: auth.team || "unknown",
      socketModeOk: true, // If auth.test works, tokens are good. Bolt manages socket mode.
    };
  } catch (error) {
    throw new Error(`Slack verification failed: ${(error as Error).message}`);
  }
}
