import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const GWRK_DIR = path.join(os.homedir(), ".gwrk");
const PID_FILE = path.join(GWRK_DIR, "server.pid");
const SERVICE_NAME = "com.gwrk.server";

export function writePid(pid: number): void {
  const dir = path.dirname(PID_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(PID_FILE, pid.toString(), "utf8");
}

export function readPid(): number | undefined {
  // 1. Try launchctl first (authority on macOS)
  try {
    const cmd = `launchctl list ${SERVICE_NAME} | grep PID | awk '{print $3}' | sed 's/;//'`;
    const output = execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    if (output) {
      const pid = Number.parseInt(output, 10);
      if (!Number.isNaN(pid)) {
        return pid;
      }
    }
  } catch {
    // Service not loaded or launchctl failed
  }

  // 2. Fallback to PID file
  if (!fs.existsSync(PID_FILE)) {
    return undefined;
  }
  const content = fs.readFileSync(PID_FILE, "utf8").trim();
  const pid = Number.parseInt(content, 10);
  return Number.isNaN(pid) ? undefined : pid;
}

export function removePid(): void {
  if (fs.existsSync(PID_FILE)) {
    try {
      fs.unlinkSync(PID_FILE);
    } catch {
      // ignore
    }
  }
}

export function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
