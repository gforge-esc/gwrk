/**
 * Module does not exist yet (RED)
 */
import { describe, expect, it } from "vitest";
import { buildProjectContext } from "./agent-context.js";

describe("agent-context", () => {
  it("should assemble deep project context including specs, plans, and tasks (Phase 2)", async () => {
    const context = await buildProjectContext("/Users/gonzo/Code/gwrk");
    
    expect(context).toContain("003-slack");
    expect(context).toContain("spec.md");
    expect(context).toContain("plan.md");
    // Deep context should include some content, not just filenames
    expect(context.length).toBeGreaterThan(100);
  });
});
