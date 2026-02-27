import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-test-"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Mocking process.exit to prevent the test runner from exiting
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should load a valid config", () => {
    const config = {
      project: { name: "test-project" },
      agents: { define: "gemini", implement: "codex-cloud" },
    };
    fs.writeFileSync(
      path.join(tempDir, ".gwrkrc.json"),
      JSON.stringify(config),
    );

    const result = loadConfig(tempDir);
    expect(result).toEqual(config);
  });

  it("should crash if .gwrkrc.json is missing", () => {
    expect(() => loadConfig(tempDir)).toThrow("process.exit(1)");
    expect(console.error).toHaveBeenCalledWith(
      "Configuration file .gwrkrc.json not found",
    );
  });

  it("should crash if .gwrkrc.json is invalid JSON", () => {
    fs.writeFileSync(path.join(tempDir, ".gwrkrc.json"), "invalid-json");
    expect(() => loadConfig(tempDir)).toThrow("process.exit(1)");
    expect(console.error).toHaveBeenCalledWith(
      "Configuration error: invalid JSON",
    );
  });

  it("should crash if .gwrkrc.json misses required fields", () => {
    const invalidConfig = {
      project: { name: "test" },
      // agents is missing
    };
    fs.writeFileSync(
      path.join(tempDir, ".gwrkrc.json"),
      JSON.stringify(invalidConfig),
    );
    expect(() => loadConfig(tempDir)).toThrow("process.exit(1)");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Configuration error"),
    );
  });
});
