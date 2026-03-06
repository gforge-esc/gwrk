// src/server/pid.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPid, removePid, writePid } from "./pid.js";

describe("FR-011: Daemon PID Management", () => {
  let tempDir: string;
  let pidPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-pid-test-"));
    pidPath = path.join(tempDir, "server.pid");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should write process.pid to file", () => {
    // US-007 acceptance scenario 1
    writePid(pidPath);
    expect(fs.existsSync(pidPath)).toBe(true);
    const writtenPid = Number.parseInt(fs.readFileSync(pidPath, "utf-8"), 10);
    expect(writtenPid).toBe(process.pid);
  });

  it("should read pid from file and verify process is alive", () => {
    // US-007 acceptance scenario 1
    fs.writeFileSync(pidPath, process.pid.toString());
    const pid = readPid(pidPath);
    expect(pid).toBe(process.pid);
  });

  it("should return null if pid file does not exist", () => {
    const pid = readPid(pidPath);
    expect(pid).toBeNull();
  });

  it("should return null if process is dead (stale PID)", () => {
    // US-007 acceptance scenario 1 (partial)
    // We use a PID that is likely not running
    fs.writeFileSync(pidPath, "999999");
    const pid = readPid(pidPath);
    expect(pid).toBeNull();
  });

  it("should remove pid file", () => {
    // US-007 acceptance scenario 2
    fs.writeFileSync(pidPath, process.pid.toString());
    removePid(pidPath);
    expect(fs.existsSync(pidPath)).toBe(false);
  });

  it("should no-op if removing non-existent pid file", () => {
    expect(() => removePid(pidPath)).not.toThrow();
  });
});
