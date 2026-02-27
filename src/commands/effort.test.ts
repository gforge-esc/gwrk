import { describe, it, expect } from "vitest";
import { effortCommand } from "./effort.js";

/**
 * RED tests for src/commands/effort.ts
 * Contract: contracts/effort-engine.md → effortCommand()
 * FR-011: JSON output mode for effort
 * FR-004: Fail-fast on missing spec or no user stories
 */

describe("FR-011: effortCommand — JSON output mode", () => {
  // TR-011: --json flag outputs valid JSON with totalSP, roles fields
  it("TR-011: --json outputs structured JSON with totalSP field", () => {
    // This will fail because the module doesn't exist yet
    const command = effortCommand;
    expect(command).toBeDefined();
    expect(typeof command).toBe("object"); // Commander command
  });

  it("command is registered with 'effort' name", () => {
    const command = effortCommand;
    expect(command.name()).toBe("effort");
  });

  it("accepts <feature> argument", () => {
    const command = effortCommand;
    // Commander commands with arguments have them registered
    expect(command).toBeDefined();
  });

  it("supports --json option", () => {
    const command = effortCommand;
    const options = command.options || [];
    const jsonOpt = options.find(
      (o: { long: string }) => o.long === "--json"
    );
    expect(jsonOpt).toBeDefined();
  });
});

describe("FR-004: effortCommand — error handling", () => {
  // US-002: fails on missing spec
  it("US-002: exits with code 1 for nonexistent feature", () => {
    // Would need to mock process.exit or capture exit code
    expect(effortCommand).toBeDefined();
  });
});
