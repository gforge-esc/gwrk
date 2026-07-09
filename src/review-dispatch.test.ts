/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("T053: Review Dispatch Architecture (ADR-007)", () => {
  describe("Prompt content verification", () => {
    const builtinReviewDir = path.join(
      import.meta.dirname,
      "plugins/builtins/reviews",
    );

    const reviewPlugins = [
      "review-code-cli",
      "review-code-webapp",
      "review-uat-cli",
      "review-uat-webapp",
    ];

    for (const plugin of reviewPlugins) {
      it(`${plugin}/PROMPT.md contains production prompt (not skeleton)`, () => {
        const promptPath = path.join(builtinReviewDir, plugin, "PROMPT.md");
        expect(fs.existsSync(promptPath)).toBe(true);

        const content = fs.readFileSync(promptPath, "utf-8");
        const lineCount = content.split("\n").length;

        // The skeleton was 41 lines. Production prompt is 160+ lines.
        expect(lineCount).toBeGreaterThan(100);

        // Must contain the scope constraints and core sections
        expect(content).toContain("<scope_constraints>");
        expect(content).toContain("## Algorithm");
        expect(content).toContain("## Anti-Patterns");
      });

      it(`${plugin}/manifest.yaml has outputSchema with verdict field`, () => {
        const manifestPath = path.join(
          builtinReviewDir,
          plugin,
          "manifest.yaml",
        );
        expect(fs.existsSync(manifestPath)).toBe(true);

        const content = fs.readFileSync(manifestPath, "utf-8");
        expect(content).toContain("verdict");
        expect(content).toContain("reopenedTasks");
        expect(content).toContain("outputSchema");
      });
    }
  });

  describe("Fail-fast resolution", () => {
    it("review-plugin.ts does not contain hardcoded fallback", () => {
      const pluginPath = path.join(
        import.meta.dirname,
        "plugins/review-plugin.ts",
      );
      const content = fs.readFileSync(pluginPath, "utf-8");

      // No hardcoded fallback descriptions
      expect(content).not.toContain("Hardcoded Fallback");
      // No silent console.warn degradation
      expect(content).not.toContain("Falling back to built-in defaults");
      // Must throw on failure
      expect(content).toContain("throw new Error");
    });
  });

  describe("Plugin-resolved prompt dispatch", () => {
    it("ship-orchestrator.ts imports PluginLoader for review prompt resolution", () => {
      const orchPath = path.join(
        import.meta.dirname,
        "engine/ship-orchestrator.ts",
      );
      const content = fs.readFileSync(orchPath, "utf-8");

      // Must dynamically import PluginLoader in executeReviewWorkflow
      expect(content).toContain("../plugins/loader.js");
    });

    it("ship-orchestrator.ts resolves PROMPT.md from plugin system", () => {
      const orchPath = path.join(
        import.meta.dirname,
        "engine/ship-orchestrator.ts",
      );
      const content = fs.readFileSync(orchPath, "utf-8");

      // Must resolve plugin and load PROMPT.md
      expect(content).toContain("loader.resolvePlugin(workflowName)");
      expect(content).toContain("PROMPT.md");

      // Must use raw dispatch (not WorkflowRuntime) for native tool access
      const reviewMethod = content.slice(
        content.indexOf("executeReviewWorkflow"),
        content.indexOf("private getNextStage"),
      );
      expect(reviewMethod).toContain("this.dispatchWithFailback");
      // Must NOT use WorkflowRuntime (intent guards block review agents)
      expect(content).not.toContain(
        'import { WorkflowRuntime } from "../plugins/workflow-runtime.js"',
      );
    });
  });
});
