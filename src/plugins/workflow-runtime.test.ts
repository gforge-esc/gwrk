import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchToAgent } from "../utils/agent.js";
import { PluginLoader, PluginNotFoundError } from "./loader.js";
import { WorkflowRuntime } from "./workflow-runtime.js";

/**
 * Phase 4 - WorkflowRuntime (Layer 2.5 - F014-R)
 */

vi.mock("./loader.js", () => ({
  PluginLoader: vi.fn(),
  PluginNotFoundError: class PluginNotFoundError extends Error {
    constructor(name: string) {
      super(`Plugin '${name}' not found.`);
      this.name = "PluginNotFoundError";
    }
  },
}));

vi.mock("../utils/agent.js", () => ({
  dispatchToAgent: vi.fn(),
}));

vi.mock("node:fs/promises", () => {
  const mockFs = {
    readFile: vi.fn(),
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  };
  return {
    ...mockFs,
    default: mockFs,
  };
});

describe("WorkflowRuntime (FR-L25-001, FR-L25-006, FR-L25-007)", () => {
  let runtime: WorkflowRuntime;
  let mockLoader: any;

  beforeEach(() => {
    mockLoader = {
      resolvePlugin: vi.fn(),
    };
    (PluginLoader as any).mockImplementation(() => mockLoader);
    runtime = new WorkflowRuntime(mockLoader);
    vi.clearAllMocks();
  });

  describe("resolveWorkflow (FR-L25-006, US-015)", () => {
    it("US-015: SHOULD prioritize project-local overrides over global built-ins", async () => {
      mockLoader.resolvePlugin.mockResolvedValue({
        manifest: { name: "gwrk-specify", type: "workflow" },
        path: "/tmp/project/.gwrk/plugins/workflows/gwrk-specify",
      });

      const manifest = await runtime.resolveWorkflow(
        "gwrk-specify",
        "/tmp/project",
      );
      expect(manifest.name).toBe("gwrk-specify");
    });

    it("FR-L25-006: SHOULD fallback to global built-ins if local override is missing", async () => {
      mockLoader.resolvePlugin.mockResolvedValue({
        manifest: { name: "gwrk-plan", type: "workflow" },
        path: "/home/user/.gwrk/plugins/workflows/gwrk-plan",
      });

      const manifest = await runtime.resolveWorkflow(
        "gwrk-plan",
        "/tmp/empty-project",
      );
      expect(manifest.name).toBe("gwrk-plan");
    });

    it("FR-L25-001: SHOULD throw WorkflowNotFoundError if workflow cannot be resolved", async () => {
      mockLoader.resolvePlugin.mockRejectedValue(
        new (PluginNotFoundError as any)("nonexistent-workflow"),
      );

      await expect(
        runtime.resolveWorkflow("nonexistent-workflow"),
      ).rejects.toThrow("Workflow 'nonexistent-workflow' not found");
    });
  });

  describe("executeWorkflow (FR-L25-001, FR-L25-007, US-011)", () => {
    const mockManifest = {
      name: "gwrk-specify",
      type: "workflow",
      outputSchema: { type: "object" },
    };

    beforeEach(() => {
      mockLoader.resolvePlugin.mockResolvedValue({
        manifest: mockManifest,
        path: "/fake/path",
      });
      (readFile as any).mockResolvedValue("Mock Prompt");
    });

    it("US-011: SHOULD execute a built-in workflow and return valid intents", async () => {
      (dispatchToAgent as any).mockResolvedValue({
        exitCode: 0,
        stdout: JSON.stringify({
          summary: "Created spec",
          intents: [
            { action: "WRITE_FILE", filePath: "spec.md", content: "# Spec" },
          ],
        }),
        stderr: "",
        durationS: 1,
      });

      const result = await runtime.executeWorkflow(
        "gwrk-specify",
        "Implement a new feature",
      );

      expect(result.summary).toBe("Created spec");
      expect(result.intents.length).toBe(1);
      expect(result.intents[0].action).toBe("WRITE_FILE");
    });

    it("FR-L25-001: SHOULD validate agent output against the workflow's outputSchema", async () => {
      (dispatchToAgent as any).mockResolvedValue({
        exitCode: 0,
        stdout: "Not a JSON object",
        stderr: "",
        durationS: 1,
      });

      await expect(
        runtime.executeWorkflow("gwrk-specify", "invalid-output"),
      ).rejects.toThrow(/Workflow output failed schema constraint/);
    });

    it("FR-L25-007: SHOULD support multi-action intents from a single turn", async () => {
      (dispatchToAgent as any).mockResolvedValue({
        exitCode: 0,
        stdout: JSON.stringify({
          summary: "Multi action",
          intents: [
            { action: "CREATE_DIR", dirPath: "src" },
            { action: "WRITE_FILE", filePath: "src/main.ts", content: "" },
          ],
        }),
        stderr: "",
        durationS: 1,
      });

      const result = await runtime.executeWorkflow(
        "gwrk-plan",
        "Create a plan with multiple files",
      );
      expect(result.intents.length).toBe(2);
    });

    it("FR-L25-001: SHOULD catch attempted direct FS edits by agents and exit 1", async () => {
      (dispatchToAgent as any).mockResolvedValue({
        exitCode: 0,
        stdout: JSON.stringify({
          summary: "Naughty agent",
          intents: [
            { action: "RUN_COMMAND", command: 'echo "hacked" > /etc/passwd' },
          ],
        }),
        stderr: "",
        durationS: 1,
      });

      await expect(
        runtime.executeWorkflow("gwrk-implement", "attempt-direct-fs-edit"),
      ).rejects.toThrow(
        /Workflow execution violation: Use WRITE_FILE JSON intent only/,
      );
    });
  });
});
