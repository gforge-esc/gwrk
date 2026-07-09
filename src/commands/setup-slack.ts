/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import { CommandError } from "../utils/signal.js";
import { 
  loadSlackConfig, 
  verifySlackConfig, 
  getEnvPath 
} from "../utils/slack-client.js";

export interface SlackSetupResult {
  alreadyConfigured: boolean;
  tokensWritten: boolean;
  workspace?: string;
  socketModeOk: boolean;
}

/**
 * Slack Setup.
 * Refactored to be callable from init flow.
 */
export const setupSlack = async (options: any): Promise<SlackSetupResult> => {
  const existingConfig = loadSlackConfig();

  const botToken = options.botToken || process.env.SLACK_BOT_TOKEN || (options.verify ? existingConfig?.botToken : undefined);
  const appToken = options.appToken || process.env.SLACK_APP_TOKEN || (options.verify ? existingConfig?.appToken : undefined);

  if (existingConfig && !options.verify && !options.botToken && !options.appToken) {
    const verification = await verifySlackConfig(existingConfig);
    if (verification.socketModeOk) {
      console.log("Slack already configured");
      return {
        alreadyConfigured: true,
        tokensWritten: false,
        workspace: verification.workspace,
        socketModeOk: true,
      };
    }
  }

  if (!botToken || !appToken) {
    if (options.nonInteractive || options.agent) {
      // In non-interactive/agent mode, we don't fail, we just skip slack setup
      return {
        alreadyConfigured: false,
        tokensWritten: false,
        socketModeOk: false,
      };
    }
    console.error("Slack credentials not found. Set SLACK_BOT_TOKEN and SLACK_APP_TOKEN.");
    throw new CommandError("Slack credentials not found", 1);
  }

  const verification = await verifySlackConfig({ botToken, appToken });
  if (!verification.socketModeOk) {
    throw new CommandError("Slack token verification failed", 1);
  }

  // Write to .env
  const envPath = getEnvPath();
  const envDir = Buffer.from(envPath).toString().substring(0, envPath.lastIndexOf("/"));
  if (!fs.existsSync(envDir)) {
    fs.mkdirSync(envDir, { recursive: true });
  }

  let envContent = "";
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, "utf-8");
  }

  const lines = envContent.split("\n").filter(line => 
    !line.startsWith("SLACK_BOT_TOKEN=") && !line.startsWith("SLACK_APP_TOKEN=")
  );
  lines.push(`SLACK_BOT_TOKEN=${botToken}`);
  lines.push(`SLACK_APP_TOKEN=${appToken}`);

  fs.writeFileSync(envPath, lines.join("\n"));
  console.log(`Slack app configured for workspace: ${verification.workspace}`);

  if (options.verify) {
    console.log("Socket Mode: OK");
  }

  return {
    alreadyConfigured: false,
    tokensWritten: true,
    workspace: verification.workspace,
    socketModeOk: true,
  };
};
