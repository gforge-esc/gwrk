/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface DeviceRecord {
  id: string;
  hostname: string;
  role: "server" | "remote";
  createdAt: string;
}

/**
 * Path to the per-machine device identity file.
 * GWRK_HOME overrides ~/.gwrk for testing.
 */
function devicePath(): string {
  const gwrkHome = process.env.GWRK_HOME || path.join(os.homedir(), ".gwrk");
  return path.join(gwrkHome, "device.json");
}

/** Read the device record, or null if this machine has never run init. */
export function loadDevice(): DeviceRecord | null {
  const p = devicePath();
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    if (!raw.id || !raw.role) return null;
    return raw as DeviceRecord;
  } catch {
    return null;
  }
}

/**
 * Create or update the device record. Preserves existing id on re-init;
 * only role and hostname are refreshed.
 */
export function saveDevice(role: "server" | "remote"): DeviceRecord {
  const p = devicePath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const existing = loadDevice();
  const record: DeviceRecord = {
    id: existing?.id ?? crypto.randomUUID(),
    hostname: os.hostname(),
    role,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };

  fs.writeFileSync(p, JSON.stringify(record, null, 2));
  return record;
}

export function isServer(): boolean {
  return loadDevice()?.role === "server";
}

export function isRemote(): boolean {
  return loadDevice()?.role === "remote";
}
