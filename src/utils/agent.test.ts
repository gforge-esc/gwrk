import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildCommand } from "./agent.js";

vi.mock("node:fs", () => ({
  default: {
    readFileSync: vi.fn().mockReturnValue("mock workflow content"),
    mkdirSync: vi.fn(),
    createWriteStream: vi.fn(() => ({
      write: vi.fn(),
      end: vi.fn(),
    })),
  },
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
