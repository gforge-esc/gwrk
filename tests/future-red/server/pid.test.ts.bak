import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writePid, readPid, removePid } from "./pid.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// FR-011: PID file management
describe("FR-011: PID File Manager", () => {
  const tmpDir = path.join(os.tmpdir(), `gwrk-pid-test-${Date.now()}`);
  const pidPath = path.join(tmpDir, "server.pid");

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // US-007: Daemon PID Management — writePid
  describe("writePid()", () => {
    it("US-007 #1: writes process.pid to the specified path", () => {
      writePid(pidPath);
      const content = fs.readFileSync(pidPath, "utf-8").trim();
      expect(Number(content)).toBe(process.pid);
    });

    it("US-007 #2: creates parent directories if they don't exist", () => {
      const nestedPath = path.join(tmpDir, "nested", "deep", "server.pid");
      writePid(nestedPath);
      expect(fs.existsSync(nestedPath)).toBe(true);
    });
  });

  // US-007: Daemon PID Management — readPid
  describe("readPid()", () => {
    it("US-007 #3: returns the PID number when file exists and process is alive", () => {
      fs.writeFileSync(pidPath, String(process.pid));
      const result = readPid(pidPath);
      expect(result).toBe(process.pid);
    });

    it("US-007 #4: returns null when PID file does not exist", () => {
      const result = readPid(path.join(tmpDir, "nonexistent.pid"));
      expect(result).toBeNull();
    });

    it("US-007 #5: returns null when process is dead (stale PID)", () => {
      // PID 99999 is almost certainly not running
      fs.writeFileSync(pidPath, "99999");
      const result = readPid(pidPath);
      expect(result).toBeNull();
    });
  });

  // US-007: Daemon PID Management — removePid
  describe("removePid()", () => {
    it("US-007 #6: removes the PID file", () => {
      fs.writeFileSync(pidPath, String(process.pid));
      removePid(pidPath);
      expect(fs.existsSync(pidPath)).toBe(false);
    });

    it("US-007 #7: no-op when file does not exist", () => {
      expect(() => removePid(path.join(tmpDir, "nonexistent.pid"))).not.toThrow();
    });
  });
});
