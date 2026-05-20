import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPidRunning, resolvePid, writePid } from "./pid.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

describe("PID Management (FR-015)", () => {
  let tempDir: string;
  let pidFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-pid-test-"));
    pidFile = path.join(os.homedir(), ".gwrk", "server.pid");
    vi.spyOn(process, "kill").mockImplementation(() => true);
    
    // Default to non-darwin for some tests, then override
    Object.defineProperty(process, "platform", { value: "linux" });
  });

  afterEach(() => {
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should write and read PID file", () => {
    writePid(12345);
    expect(fs.existsSync(pidFile)).toBe(true);
    expect(fs.readFileSync(pidFile, "utf8")).toBe("12345");
  });

  it("should resolve PID from file if not on darwin", () => {
    writePid(12345);
    expect(resolvePid()).toBe(12345);
  });

  it("should prioritize launchctl on darwin", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    writePid(12345); // File PID
    
    // Mock launchctl list returning a different PID
    vi.mocked(execSync).mockReturnValue(Buffer.from('"PID" = 54321;'));

    expect(resolvePid()).toBe(54321);
  });

  it("should fallback to PID file on darwin if launchctl fails", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    writePid(12345); // File PID
    
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("Could not find service");
    });

    expect(resolvePid()).toBe(12345);
  });

  it("should return undefined if PID is not running", () => {
    writePid(12345);
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });

    expect(resolvePid()).toBe(undefined);
  });
});
