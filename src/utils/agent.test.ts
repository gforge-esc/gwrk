import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildCommand, dispatchAgent } from "./agent.js";

import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";

const mockWrite = vi.fn();
const mockEnd = vi.fn();

vi.mock("node:fs", () => ({
  default: {
    readFileSync: vi.fn().mockReturnValue("mock workflow content"),
    mkdirSync: vi.fn(),
    createWriteStream: vi.fn(() => ({
      write: mockWrite,
      end: mockEnd,
    })),
  },
}));

const mockSpawn = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

describe("buildCommand — agent backend routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds gemini slash command with -p flag matching agent-run.sh", () => {
    const result = buildCommand(
      {
        backend: "gemini",
        workflowPath: ".agent/workflows/specify.md",
        prompt: "test feature",
      },
      "mock workflow content",
    );

    expect(result.command).toBe("gemini");
    // Should produce: gemini -p "/specify test feature" --approval-mode yolo
    expect(result.args).toEqual(["-p", "/specify test feature", "--approval-mode", "yolo"]);
    expect(result.stdin).toBeUndefined();
  });

  it("builds gemini plan command with featureDir", () => {
    const result = buildCommand(
      {
        backend: "gemini",
        workflowPath: ".agent/workflows/plan.md",
        featureDir: "specs/001-cli-core",
      },
      "mock workflow content",
    );

    expect(result.command).toBe("gemini");
    expect(result.args).toEqual(["-p", "/plan specs/001-cli-core", "--approval-mode", "yolo"]);
  });

  it("uses plan approval mode for analyze (read-only)", () => {
    const result = buildCommand(
      {
        backend: "gemini",
        workflowPath: ".agent/workflows/analyze.md",
        featureDir: "specs/001-cli-core",
      },
      "mock workflow content",
    );

    expect(result.args).toEqual(["-p", "/analyze specs/001-cli-core", "--approval-mode", "plan"]);
  });

  it("builds correct command for claude with -p flag", () => {
    const result = buildCommand(
      {
        backend: "claude",
        workflowPath: ".agent/workflows/plan.md",
        featureDir: "specs/test-feature",
      },
      "mock workflow content",
    );

    expect(result.command).toBe("claude");
    expect(result.args).toContain("-p");
    expect(result.args).toContain("--output-format");
    expect(result.args).toContain("specs/test-feature");
  });

  it("builds correct command for codex with exec --full-auto", () => {
    const result = buildCommand(
      {
        backend: "codex",
        workflowPath: ".agent/workflows/analyze.md",
        featureDir: "specs/test-feature",
      },
      "mock workflow content",
    );

    expect(result.command).toBe("codex");
    expect(result.args).toEqual([
      "exec",
      "--full-auto",
      ".agent/workflows/analyze.md",
      "specs/test-feature",
    ]);
  });

  it("builds correct command for codex-cloud with run --cloud", () => {
    const result = buildCommand(
      {
        backend: "codex-cloud",
        workflowPath: ".agent/workflows/effort.md",
        featureDir: "specs/test-feature",
      },
      "mock workflow content",
    );

    expect(result.command).toBe("codex");
    expect(result.args).toEqual([
      "run",
      "--cloud",
      "--non-interactive",
      "--full-auto",
      ".agent/workflows/effort.md",
      "specs/test-feature",
    ]);
  });
});

describe("dispatchAgent — process execution and stream handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWrite.mockClear();
    mockEnd.mockClear();
    mockSpawn.mockClear();
  });

  const runOpts = {
    backend: "gemini" as const,
    workflowPath: ".agent/workflows/plan.md",
    featureDir: "specs/test-feature",
  };

  it("should spawn agent, trace stdout/stderr, and return 0 on success", async () => {
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();
    const stdinStream = new PassThrough();
    
    // Fake ChildProcess
    const child = new EventEmitter() as any;
    child.stdout = stdoutStream;
    child.stderr = stderrStream;
    child.stdin = stdinStream;
    
    mockSpawn.mockReturnValue(child);

    const promise = dispatchAgent(runOpts);

    // Write some logs through the simulated agent output
    stdoutStream.write("Doing work...\n");
    stderrStream.write("Debug info...\n");
    
    // Simulate natural process exit
    child.emit("close", 0);

    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(result.logPath).toContain("test-feature.log");

    // Verify it created a write stream to the log
    expect(mockWrite).toHaveBeenCalledWith(expect.stringContaining("Doing work...\n"));
    expect(mockWrite).toHaveBeenCalledWith(expect.stringContaining("Debug info...\n"));
    expect(mockEnd).toHaveBeenCalled();
  });

  it("should propagate non-zero exit code if agent fails", async () => {
    const child = new EventEmitter() as any;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    mockSpawn.mockReturnValue(child);

    const promise = dispatchAgent(runOpts);
    child.emit("close", 123);

    const result = await promise;
    expect(result.exitCode).toBe(123);
  });

  it("should return exitCode 1 when spawn fails natively with error event", async () => {
    const child = new EventEmitter() as any;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    mockSpawn.mockReturnValue(child);

    const promise = dispatchAgent(runOpts);
    child.emit("error", new Error("EACCES"));

    const result = await promise;
    expect(result.exitCode).toBe(1);
    expect(mockWrite).toHaveBeenCalledWith(expect.stringContaining("[ERROR] Agent process failed to start"));
  });

  it("should squelch 429 error JSON block traces correctly", async () => {
    const stdoutStream = new PassThrough();
    const child = new EventEmitter() as any;
    child.stdout = stdoutStream;
    mockSpawn.mockReturnValue(child);

    const promise = dispatchAgent(runOpts);

    // First line triggers squelch
    stdoutStream.write("Attempt 1 failed with status 429\n");
    // Next line is part of an un-rendered JSON block
    stdoutStream.write("{\n");
    stdoutStream.write("  \"error\": \"quota exceeded\"\n");
    stdoutStream.write("}\n");
    // This line comes after squelch breaks
    stdoutStream.write("Attempt 2 succeeded\n");

    child.emit("close", 0);
    await promise;

    // Checks that the 429 marker was written to the log, but NOT the JSON squelch trace
    expect(mockWrite).toHaveBeenCalledWith(expect.stringContaining("rate limited, retrying"));
    const calls = mockWrite.mock.calls.map(c => c[0]);
    expect(calls.some(c => c.includes("quota exceeded"))).toBe(false);
    expect(mockWrite).toHaveBeenCalledWith(expect.stringContaining("Attempt 2 succeeded"));
  });
});

