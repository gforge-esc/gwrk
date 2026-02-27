import { describe, it, expect, vi, beforeEach } from "vitest";
import { compileContext, writeContextToSandbox } from "./context.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// FR-007 / FR-013: Context compilation
describe("FR-007/FR-013: Context Compiler", () => {
  const tmpDir = path.join(os.tmpdir(), `gwrk-ctx-test-${Date.now()}`);
  const featureDir = path.join(tmpDir, "specs", "001-cli-core");
  const rulesDir = path.join(tmpDir, ".agent", "rules");

  beforeEach(() => {
    // Create mock spec structure
    fs.mkdirSync(featureDir, { recursive: true });
    fs.mkdirSync(path.join(featureDir, ".gwrk"), { recursive: true });
    fs.mkdirSync(rulesDir, { recursive: true });

    fs.writeFileSync(
      path.join(featureDir, "spec.md"),
      "# Spec\nUS-001: Test story"
    );
    fs.writeFileSync(
      path.join(featureDir, "plan.md"),
      "# Plan\nPhase 1: Bootstrap"
    );
    fs.writeFileSync(
      path.join(featureDir, ".gwrk", "tasks.json"),
      JSON.stringify({
        feature: "001-cli-core",
        phases: [{ id: "1", name: "Phase 1", tasks: [] }],
      })
    );
    fs.writeFileSync(
      path.join(rulesDir, "workspace.md"),
      "# Workspace Rules\nNo defaults."
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // US-009 #1: compileContext produces Markdown with all sections
  describe("compileContext()", () => {
    it("US-009 #1: output contains Governance Rules section", async () => {
      const result = await compileContext(featureDir, "phase-01");
      expect(result).toContain("Governance Rules");
    });

    it("US-009 #2: output contains Feature Specification section", async () => {
      const result = await compileContext(featureDir, "phase-01");
      expect(result).toContain("Feature Specification");
      expect(result).toContain("US-001: Test story");
    });

    it("US-009 #3: output contains Implementation Plan section", async () => {
      const result = await compileContext(featureDir, "phase-01");
      expect(result).toContain("Implementation Plan");
    });

    it("US-009 #4: output contains Current Tasks section", async () => {
      const result = await compileContext(featureDir, "phase-01");
      expect(result).toContain("Current Tasks");
    });

    // Error: spec.md not found
    it("ERROR #1: throws when spec.md is missing", async () => {
      fs.rmSync(path.join(featureDir, "spec.md"));
      await expect(
        compileContext(featureDir, "phase-01")
      ).rejects.toThrow(/spec\.md not found/);
    });

    // Error: .agent/rules/ missing
    it("ERROR #2: throws when .agent/rules/ is missing", async () => {
      fs.rmSync(rulesDir, { recursive: true });
      await expect(
        compileContext(featureDir, "phase-01")
      ).rejects.toThrow(/\.agent\/rules\/ directory not found/);
    });
  });
});
