import fs from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Phase 10 RED Tests: .agents/ Decoupling
 * TR-P10-004: No .agents/workflows/ string check
 */
describe("slack-agent.ts (Phase 10 RED)", () => {
  it("ADR-007: should not contain .agents/workflows/ string check (TR-P10-004)", () => {
    const content = fs.readFileSync("src/server/slack-agent.ts", "utf-8");
    // This should fail pre-implementation because L26 contains ".agents/workflows/"
    expect(content).not.toContain(".agents/workflows/");
  });

  it("should not contain any .agents/ references in the file (Negative Path)", () => {
    const content = fs.readFileSync("src/server/slack-agent.ts", "utf-8");
    const agentsPaths = content.match(/\.agents\//g);
    expect(agentsPaths, `Found legacy .agents/ paths: ${agentsPaths}`).toBeNull();
  });
});
