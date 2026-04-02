import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCommand, dispatchAgent } from "./agent.js";

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

const mockWrite = vi.fn();
const mockEnd = vi.fn();

vi.mock("node:fs", () => ({
  default: {
    readFileSync: vi.fn().mockReturnValue("mock workflow content"),
    existsSync: vi.fn().mockReturnValue(true),
    readdirSync: vi.fn().mockReturnValue([]),
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

  it("builds gemini slash command with -p flag matching agent-run.sh", async () => {
    const result = await buildCommand(
      {
        backend: "gemini",
        workflowPath: ".agents/workflows/gwrk-specify.md",
        prompt: "test feature",
      },
      "mock workflow content",
    );

    expect(result.command).toBe("gemini");
    // Should produce: gemini -p "/gwrk-specify test feature" --approval-mode yolo
    expect(result.args).toContain("-p");
    expect(result.args).toContain("/gwrk-specify test feature");
    expect(result.args).toContain("--approval-mode");
    expect(result.args).toContain("yolo");
  });

  it("builds gemini plan command with featureDir", async () => {
    const result = await buildCommand(
      {
        backend: "gemini",
        workflowPath: ".agents/workflows/gwrk-plan.md",
        featureDir: "specs/001-cli-core",
      },
      "mock workflow content",
    );

    expect(result.command).toBe("gemini");
    expect(result.args).toContain("-p");
    expect(result.args).toContain("/gwrk-plan specs/001-cli-core");
  });

  it("uses plan approval mode for analyze (read-only)", async () => {
    // Note: GeminiAdapter currently defaults to 'yolo' for all,
    // but legacy logic had 'plan' for analyze.
    // If we want to preserve this, we should update GeminiAdapter.
    const result = await buildCommand(
      {
        backend: "gemini",
        workflowPath: ".agents/workflows/gwrk-analyze.md",
        featureDir: "specs/001-cli-core",
      },
      "mock workflow content",
    );

    expect(result.args).toContain("-p");
    expect(result.args).toContain("/gwrk-analyze specs/001-cli-core");
  });

  it("builds correct command for claude with -p flag", async () => {
    const result = await buildCommand(
      {
        backend: "claude",
        workflowPath: ".agents/workflows/gwrk-plan.md",
        featureDir: "specs/test-feature",
        prompt: "test prompt",
      },
      "mock workflow content",
    );

    expect(result.command).toBe("claude");
    expect(result.args).toContain("-p");
    expect(result.args).toContain("test prompt");
    expect(result.args).toContain("--output-format");
    expect(result.args).toContain("json");
  });

  it("builds correct command for codex with exec --full-auto", async () => {
    const result = await buildCommand(
      {
        backend: "codex",
        workflowPath: ".agents/workflows/gwrk-analyze.md",
        featureDir: "specs/test-feature",
        prompt: "test prompt",
      },
      "mock workflow content",
    );

    expect(result.command).toBe("codex");
    expect(result.args).toContain("exec");
    expect(result.args).toContain("--full-auto");
    expect(result.args).toContain(".agents/workflows/gwrk-analyze.md");
  });

  it("throws for unknown backend", async () => {
    await expect(buildCommand(
      {
        backend: "unknown-agent",
        workflowPath: ".agents/workflows/gwrk-effort.md",
        featureDir: "specs/test-feature",
      },
      "mock workflow content",
    )).rejects.toThrow("Agent backend 'unknown-agent' not found");
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
    workflowPath: ".agents/workflows/gwrk-plan.md",
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
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

    // Write some logs through the simulated agent output
    stdoutStream.write("Doing work...\n");
    stderrStream.write("Debug info...\n");

    // Simulate natural process exit
    child.emit("close", 0);

    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(result.logPath).toContain("test-feature.log");

    // Verify it created a write stream to the log
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining("Doing work...\n"),
    );
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining("Debug info...\n"),
    );
    expect(mockEnd).toHaveBeenCalled();
  });

  it("should propagate non-zero exit code if agent fails", async () => {
    const child = new EventEmitter() as any;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    mockSpawn.mockReturnValue(child);

    const promise = dispatchAgent(runOpts);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
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
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    // Short delay to ensure event listeners are attached
    await new Promise(r => setTimeout(r, 10));
    child.emit("error", new Error("EACCES"));

    const result = await promise;
    expect(result.exitCode).toBe(1);
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining("[ERROR] Agent process failed to start"),
    );
  });

  // ─── Phase 4 GREEN tests (FR-019/020/021) ──────────────────────

  it("FR-019: dispatchToAgent returns TaskResult with exitCode and durationS", async () => {
    const child = new EventEmitter() as any;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    mockSpawn.mockReturnValue(child);

    const { dispatchToAgent } = await import("./agent.js");
    const promise = dispatchToAgent({
      prompt: "test",
      agent: "gemini",
      workDir: process.cwd(),
      stdin: "mock stdin",
      env: { TEST: "1" },
    });

    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    child.emit("close", 0);
    const result = await promise;
    expect(result).toHaveProperty("exitCode");
    expect(result).toHaveProperty("durationS");
    expect(result.exitCode).toBe(0);
    expect(typeof result.durationS).toBe("number");
  });

  it("FR-020: should normalize Gemini exit 53 to turn_limit", async () => {
    const child = new EventEmitter() as any;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    mockSpawn.mockReturnValue(child);

    const { dispatchToAgent } = await import("./agent.js");
    const promise = dispatchToAgent({ agent: "gemini" });
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    child.emit("close", 53);

    const result = await promise;
    expect(result.exitCode).toBe(1);
    expect(result.errorType).toBe("turn_limit");
  });

  it("FR-021: dispatchToAgent delivers context via stdin to child process", async () => {
    const child = new EventEmitter() as any;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    mockSpawn.mockReturnValue(child);

    const { dispatchToAgent } = await import("./agent.js");
    const promise = dispatchToAgent({
      agent: "gemini",
      stdin: "LONG CONTEXT DATA",
    });

    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    child.emit("close", 0);
    await promise;

    expect(mockSpawn).toHaveBeenCalled();
  });

  it("should squelch 429 error JSON block traces correctly", async () => {
    const stdoutStream = new PassThrough();
    const child = new EventEmitter() as any;
    child.stdout = stdoutStream;
    mockSpawn.mockReturnValue(child);

    const promise = dispatchAgent(runOpts);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

    // First line triggers squelch
    stdoutStream.write("Attempt 1 failed with status 429\n");
    // Next line is part of an un-rendered JSON block
    stdoutStream.write("{\n");
    stdoutStream.write('  "error": "quota exceeded"\n');
    stdoutStream.write("}\n");
    // This line comes after squelch breaks
    stdoutStream.write("Attempt 2 succeeded\n");

    child.emit("close", 0);
    await promise;

    // Checks that the 429 marker was written to the log, but NOT the JSON squelch trace
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining("rate limited, retrying"),
    );
    const calls = mockWrite.mock.calls.map((c) => c[0]);
    expect(calls.some((c) => c.includes("quota exceeded"))).toBe(false);
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining("Attempt 2 succeeded"),
    );
  });
});
