import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initCommand } from "./init.js";

describe("initCommand", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-init-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should create scaffold directories and .gwrkrc.json", async () => {
    // initCommand.action() is not async but Commander can handle it
    await initCommand.parseAsync([], { from: "user" });

    expect(fs.existsSync(path.join(tempDir, ".agent/workflows"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, ".agent/rules"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, ".specify/templates"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "specs"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, ".gwrkrc.json"))).toBe(true);

    const config = JSON.parse(
      fs.readFileSync(path.join(tempDir, ".gwrkrc.json"), "utf-8"),
    );
    expect(config.project.name).toBe(path.basename(tempDir));
    expect(config.agents.define).toBe("gemini");
    expect(config.agents.implement).toBe("codex-cloud");
  });

  it("should be idempotent and exit 0 if already initialized", async () => {
    const agentDir = path.join(tempDir, ".agent");
    fs.mkdirSync(agentDir);

    // Should throw our mocked error for process.exit(0)
    await expect(() =>
      initCommand.parseAsync([], { from: "user" }),
    ).rejects.toThrow("process.exit(0)");
    expect(console.log).toHaveBeenCalledWith("gwrk already initialized");
  });
});
