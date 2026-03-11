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
      server: { 
        port: 18790, 
        host: "localhost",
        heartbeatIntervalMs: 1000,
        networkCheckIntervalMs: 1000
      },
      parallelism: {
        local: { maxCpu: 80, maxMem: 80, minDiskGb: 10, maxClones: 2 },
        cloud: { maxConcurrent: 10 },
      },
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

  // ─── 006-pulse: Pulse config extension tests (RED) ───────────

  it("should load config with pulse.repos section", () => {
    // TR-010 / FR-001: pulse config with repos
    const config = {
      project: { name: "test-project" },
      agents: { define: "gemini", implement: "codex-cloud" },
      server: { 
        port: 18790, 
        host: "localhost",
        heartbeatIntervalMs: 1000,
        networkCheckIntervalMs: 1000
      },
      parallelism: {
        local: { maxCpu: 80, maxMem: 80, minDiskGb: 10, maxClones: 2 },
        cloud: { maxConcurrent: 10 },
      },
      pulse: { repos: ["/tmp/repo-a", "/tmp/repo-b"] },
    };
    fs.writeFileSync(
      path.join(tempDir, ".gwrkrc.json"),
      JSON.stringify(config),
    );

    const result = loadConfig(tempDir);
    expect(result).toHaveProperty("pulse");
    expect(result.pulse?.repos).toEqual(["/tmp/repo-a", "/tmp/repo-b"]);
    expect(result.pulse?.repos).toHaveLength(2);
  });

  it("should load config without pulse section (optional)", () => {
    // TC-003: pulse is optional — existing configs must not break
    const config = {
      project: { name: "test-project" },
      agents: { define: "gemini", implement: "codex-cloud" },
      server: { 
        port: 18790, 
        host: "localhost",
        heartbeatIntervalMs: 1000,
        networkCheckIntervalMs: 1000
      },
      parallelism: {
        local: { maxCpu: 80, maxMem: 80, minDiskGb: 10, maxClones: 2 },
        cloud: { maxConcurrent: 10 },
      },
    };
    fs.writeFileSync(
      path.join(tempDir, ".gwrkrc.json"),
      JSON.stringify(config),
    );

    const result = loadConfig(tempDir);
    expect(result).not.toHaveProperty("pulse");
  });

  it("should load config with empty pulse.repos array", () => {
    // Edge case: empty repos array is valid config (error caught at command level)
    const config = {
      project: { name: "test-project" },
      agents: { define: "gemini", implement: "codex-cloud" },
      server: { 
        port: 18790, 
        host: "localhost",
        heartbeatIntervalMs: 1000,
        networkCheckIntervalMs: 1000
      },
      parallelism: {
        local: { maxCpu: 80, maxMem: 80, minDiskGb: 10, maxClones: 2 },
        cloud: { maxConcurrent: 10 },
      },
      pulse: { repos: [] },
    };
    fs.writeFileSync(
      path.join(tempDir, ".gwrkrc.json"),
      JSON.stringify(config),
    );

    const result = loadConfig(tempDir);
    expect(result.pulse?.repos).toEqual([]);
  });

  it("should load config with slack project fields", () => {
    const config = {
      project: { 
        name: "test-project",
        slack: {
          channelName: "#gwrk-test",
          channelId: "C123456"
        }
      },
      agents: { define: "gemini", implement: "codex-cloud" },
    };
    fs.writeFileSync(
      path.join(tempDir, ".gwrkrc.json"),
      JSON.stringify(config),
    );

    const result = loadConfig(tempDir);
    expect(result.project.slack?.channelName).toBe("#gwrk-test");
    expect(result.project.slack?.channelId).toBe("C123456");
  });
});

import { SlackConfigSchema } from "./config.js";

describe("SlackConfigSchema", () => {
  it("should validate valid slack tokens", () => {
    const valid = {
      botToken: "xoxb-12345",
      appToken: "xapp-12345",
    };
    expect(SlackConfigSchema.parse(valid)).toEqual(valid);
  });

  it("should fail on invalid slack tokens", () => {
    const invalid = {
      botToken: "not-a-bot-token",
      appToken: "not-an-app-token",
    };
    const result = SlackConfigSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});
