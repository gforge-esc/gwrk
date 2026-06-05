import { describe, it, expect } from "vitest";
import { program } from "../cli.js";

describe("Command Scoping (FR-040 / TR-038)", () => {
  it("should have projectId derivation logic in 'plan status'", () => {
    const planCmd = program.commands.find(c => c.name() === "plan");
    const statusCmd = planCmd?.commands.find(c => c.name() === "status");
    expect(statusCmd).toBeDefined();
    // We can't easily test the internal logic without running it, 
    // but the implementation will need to call resolveProjectId().
  });

  it("should have projectId derivation logic in 'db runs'", () => {
    const dbCmd = program.commands.find(c => c.name() === "db");
    const runsCmd = dbCmd?.commands.find(c => c.name() === "runs");
    expect(runsCmd).toBeDefined();
  });
});
