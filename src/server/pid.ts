/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { gwrkRuntimeDir } from "../adapters/config/paths.js";

function pidFile(): string {
  return path.join(gwrkRuntimeDir(), "server.pid");
}
const SERVICE_NAME = "com.gwrk.server";

export function writePid(pid: number): void {
  const dir = path.dirname(pidFile());
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(pidFile(), pid.toString(), "utf8");
}

export function readPid(): number | undefined {
  // 1. Try launchctl first (authority on macOS)
  try {
    if (os.platform() === "darwin" && !process.env.GWRK_RUNTIME_DIR) {
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
    }
  } catch {
    // Service not loaded or launchctl failed
  }

  // 2. Fallback to PID file
  if (!fs.existsSync(pidFile())) {
    return undefined;
  }
  const content = fs.readFileSync(pidFile(), "utf8").trim();
  const pid = Number(content);
  return /^\d+$/.test(content) && Number.isSafeInteger(pid) && pid > 1
    ? pid
    : undefined;
}

export function removePid(): void {
  if (fs.existsSync(pidFile())) {
    try {
      const content = fs.readFileSync(pidFile(), "utf8").trim();
      if (content === process.pid.toString()) {
        fs.unlinkSync(pidFile());
      }
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
