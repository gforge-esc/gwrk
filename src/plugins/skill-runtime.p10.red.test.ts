import fs from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Phase 10 RED Tests: .agents/ Decoupling
 * TR-P10-003: No .agents/ path in log strings
 */
describe("skill-runtime.ts (Phase 10 RED)", () => {
  it("ADR-007: should not contain hardcoded .agents/ paths for logging (TR-P10-003)", () => {
    const content = fs.readFileSync("src/plugins/skill-runtime.ts", "utf-8");
    // This should fail pre-implementation because L125 contains ".agents/skills/"
    expect(content).not.toContain(".agents/skills/");
  });

  it("should not contain any legacy .agents/ references (Negative Path)", () => {
    const content = fs.readFileSync("src/plugins/skill-runtime.ts", "utf-8");
    const agentsPaths = content.match(/\.agents\//g);
    expect(agentsPaths, `Found legacy .agents/ paths: ${agentsPaths}`).toBeNull();
  });
});
