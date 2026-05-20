import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const GWRK_DIR = path.join(os.homedir(), ".gwrk");
const PID_FILE = path.join(GWRK_DIR, "server.pid");
const PLIST_NAME = "com.gwrk.server";

export function writePid(pid: number): void {
  const dir = path.dirname(PID_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(PID_FILE, pid.toString(), "utf8");
}

export function readPidFile(): number | undefined {
  if (!fs.existsSync(PID_FILE)) {
    return undefined;
  }
  try {
    const content = fs.readFileSync(PID_FILE, "utf8").trim();
    const pid = Number.parseInt(content, 10);
    return Number.isNaN(pid) ? undefined : pid;
  } catch {
    return undefined;
  }
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

export function isPidRunning(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Attempts to resolve the PID from launchctl (macOS only).
 */
export function getLaunchctlPid(): number | undefined {
  if (process.platform !== "darwin") return undefined;
  try {
    const output = execSync(`launchctl list ${PLIST_NAME}`, {
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
    const match = output.match(/"PID" = (\d+);/);
    if (match) {
      return Number.parseInt(match[1], 10);
    }
  } catch {
    // Service not found or not running
  }
  return undefined;
}

/**
 * Resolves the PID authority.
 * Priority: launchctl > PID file.
 * FR-015: Stale PID files MUST NOT cause false "running" reports.
 */
export function resolvePid(): number | undefined {
  // 1. Check launchctl (authoritative on macOS if registered)
  const launchPid = getLaunchctlPid();
  if (launchPid && isPidRunning(launchPid)) {
    return launchPid;
  }

  // 2. Check PID file (fallback)
  const filePid = readPidFile();
  if (filePid && isPidRunning(filePid)) {
    return filePid;
  }

  return undefined;
}
// Re-export for backward compat
export const readPid = resolvePid;
