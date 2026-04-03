import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DefineOrchestrator } from "../engine/define-orchestrator.js";
import { readStdin } from "../utils/output.js";
import { planCommand } from "./plan.js";

vi.mock("../engine/define-orchestrator.js");
vi.mock("../utils/output.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/output.js")>();
  return {
    ...actual,
    readStdin: vi.fn(() => Promise.resolve("")),
  };
});

describe("planCommand", () => {
  let tempDir: string;
  let executePlanSpy: any;

  beforeEach(() => {
    executePlanSpy = vi.spyOn(DefineOrchestrator.prototype, "executePlan").mockResolvedValue({
      summary: "Success",
      intents: [],
      summaries: [],
      logPath: "/tmp/test.log",
    });
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-plan-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    // Create .gwrkrc.json
    fs.writeFileSync(
      path.join(tempDir, ".gwrkrc.json"),
      JSON.stringify({
        project: { name: "test-project" },
        agents: { define: "gemini", implement: "codex-cloud" },
        server: {
          port: 18790,
          host: "localhost",
        },
        parallelism: {
          local: {
            maxCpu: 80,
            maxMem: 80,
            minDiskGb: 10,
            maxClones: 2,
          },
          cloud: {
            maxConcurrent: 10,
          },
        },
      }),
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should fail if spec.md does not exist", async () => {
    executePlanSpy.mockRejectedValueOnce(new Error("spec.md not found"));
    process.exitCode = 0;
    await planCommand.parseAsync(["feature-x"], { from: "user" });
    expect(process.exitCode).toBe(1);
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      expect.stringContaining("spec.md not found"),
    );
  });

  it("should dispatch agent if spec.md exists", async () => {
    const featureDir = path.join(tempDir, "specs/feature-x");
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(path.join(featureDir, "spec.md"), "# Spec");

    process.exitCode = 0;
    await planCommand.parseAsync(["feature-x"], { from: "user" });

    expect(process.exitCode).toBe(0);
    expect(executePlanSpy).toHaveBeenCalledWith(
      "feature-x",
      expect.objectContaining({
        agent: "gemini",
      }),
    );
  });

  it("should fail if spec.md is marked as a Stub", async () => {
    executePlanSpy.mockRejectedValueOnce(new Error("is marked as a Stub"));
    process.exitCode = 0;
    await planCommand.parseAsync(["feature-x"], { from: "user" });
    
    expect(process.exitCode).toBe(1);
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      expect.stringContaining("is marked as a Stub"),
    );
  });
});
