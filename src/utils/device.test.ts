/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDevice, saveDevice, isServer, isRemote } from "./device.js";

describe("device identity", () => {
  let tmpDir: string;
  const origEnv = process.env.GWRK_HOME;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-device-test-"));
    process.env.GWRK_HOME = tmpDir;
  });

  afterEach(() => {
    process.env.GWRK_HOME = origEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when no device.json exists", () => {
    expect(loadDevice()).toBeNull();
  });

  it("creates device.json with UUID and role", () => {
    const record = saveDevice("remote");
    expect(record.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(record.role).toBe("remote");
    expect(record.hostname).toBe(os.hostname());
    expect(record.createdAt).toBeTruthy();
  });

  it("preserves id on re-init, updates role", () => {
    const first = saveDevice("remote");
    const second = saveDevice("server");
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.role).toBe("server");
  });

  it("loadDevice round-trips", () => {
    saveDevice("server");
    const loaded = loadDevice();
    expect(loaded).not.toBeNull();
    expect(loaded!.role).toBe("server");
  });

  it("isServer / isRemote reflect saved role", () => {
    expect(isServer()).toBe(false);
    expect(isRemote()).toBe(false);

    saveDevice("server");
    expect(isServer()).toBe(true);
    expect(isRemote()).toBe(false);

    saveDevice("remote");
    expect(isServer()).toBe(false);
    expect(isRemote()).toBe(true);
  });

  it("handles corrupted device.json gracefully", () => {
    fs.writeFileSync(path.join(tmpDir, "device.json"), "not json");
    expect(loadDevice()).toBeNull();
  });
});
