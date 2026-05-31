import { describe, expect, it } from "vitest";
import { PluginLoader } from "./loader.js";
import fs from "node:fs";

/**
 * Phase 10: .agents/ Decoupling
 * TR-P10-002: Builtin workflow resolution
 */
describe("PluginLoader (Phase 10)", () => {
  it("FR-L25-003: should resolve all 15 core gwrk-* workflows (TR-P10-002)", async () => {
    // Ensure we don't pick up global state by using a non-existent global dir
    const loader = new PluginLoader({ globalDir: "/tmp/gwrk-empty-global-" + Math.random() });
    const workflows = [
      "gwrk-specify",
      "gwrk-plan",
      "gwrk-implement",
      "gwrk-define-tests",
      "gwrk-author-gates",
      "gwrk-plan-to-tasks",
      "gwrk-review-code",
      "gwrk-review-uat",
      "gwrk-research",
      "gwrk-build-plan",
      "gwrk-analyze",
      "gwrk-cascade-sync",
      "gwrk-checklist",
      "gwrk-constitution",
      "gwrk-effort"
    ];

    for (const name of workflows) {
      // US-011: WorkflowRuntime resolves from built-ins (or global fallback)
      const plugin = await loader.resolvePlugin(name);
      expect(plugin.manifest.type).toBe("workflow");
      // TC-011: Verify it's not loading from .agents/
      expect(plugin.path).not.toContain(".agents/workflows/");
      // TR-P10-002: Verify it's loading from builtins (since we blocked global)
      expect(plugin.path).toContain("src/plugins/builtins/workflows/");
    }
  });

  it("should throw PluginNotFoundError for unknown workflows (Negative Path)", async () => {
    const loader = new PluginLoader();
    await expect(loader.resolvePlugin("gwrk-non-existent")).rejects.toThrow("Plugin 'gwrk-non-existent' not found.");
  });

  describe("SC-010: Dead Code Removal (Global Cleanup)", () => {
    it("should have removed legacy parser scripts", () => {
      // These should be deleted in this phase
      expect(fs.existsSync(".agents/scripts/parser/parser-scaffold.sh")).toBe(false);
      expect(fs.existsSync(".agents/scripts/parser/parser-validate.sh")).toBe(false);
    });

    it("should have removed legacy workflow files", () => {
      // These should be deleted in this phase
      expect(fs.existsSync(".agents/workflows/plan.md")).toBe(false);
      expect(fs.existsSync(".agents/workflows/specify.md")).toBe(false);
    });
  });
});
