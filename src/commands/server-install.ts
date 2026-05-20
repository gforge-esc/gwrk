import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PLIST_NAME = "com.gwrk.server.plist";
const PLIST_PATH = path.join(os.homedir(), "Library/LaunchAgents", PLIST_NAME);
const LOG_DIR = path.join(os.homedir(), ".gwrk");
const LOG_PATH = path.join(LOG_DIR, "server.log");

export const installServer = async (): Promise<void> => {
  const nodePath = process.execPath;
  const scriptPath = process.argv[1];

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.gwrk.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${scriptPath}</string>
        <string>server</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${LOG_PATH}</string>
    <key>StandardErrorPath</key>
    <string>${LOG_PATH}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${process.env.PATH}</string>
    </dict>
</dict>
</plist>`;

  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }

  const agentsDir = path.dirname(PLIST_PATH);
  if (!fs.existsSync(agentsDir)) {
    fs.mkdirSync(agentsDir, { recursive: true });
  }

  fs.writeFileSync(PLIST_PATH, plistContent, "utf8");

  try {
    execSync(`launchctl load ${PLIST_PATH}`, { stdio: "ignore" });
  } catch (error) {
    throw new Error(`Failed to load LaunchAgent: ${error instanceof Error ? error.message : String(error)}`);
  }
};

export const uninstallServer = async (): Promise<void> => {
  try {
    execSync(`launchctl unload ${PLIST_PATH}`, { stdio: "ignore" });
  } catch {
    // Ignore errors if already unloaded
  }

  if (fs.existsSync(PLIST_PATH)) {
    fs.unlinkSync(PLIST_PATH);
  }
};

export const getLogs = async (options: { follow?: boolean } = {}): Promise<void> => {
  if (!fs.existsSync(LOG_PATH)) {
    console.log("No log file found.");
    return;
  }

  const cmd = options.follow ? `tail -f ${LOG_PATH}` : `cat ${LOG_PATH}`;
  // In a real CLI, we might want to pipe this or use a different approach
  // for this implementation we'll just exec it to stdout
  try {
    execSync(cmd, { stdio: "inherit" });
  } catch {
    // ignore
  }
};
