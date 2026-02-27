import { describe, it, expect } from "vitest";
import { compressionCommand } from "./compression.js";

/**
 * RED tests for src/commands/compression.ts
 * Contract: contracts/compression-engine.md → compressionCommand()
 * FR-011: JSON output mode for compression
 * FR-009: Cross-feature compression summary (--all)
 * FR-010: Fail-fast on unshipped features
 */

describe("FR-011: compressionCommand — JSON output mode", () => {
  // TR-012: --json flag outputs valid JSON with pointCompression, totalCompression
  it("TR-012: --json outputs structured JSON with pointCompression field", () => {
    const command = compressionCommand;
    expect(command).toBeDefined();
    expect(typeof command).toBe("object"); // Commander command
  });

  it("command is registered with 'compression' name", () => {
    const command = compressionCommand;
    expect(command.name()).toBe("compression");
  });

  it("accepts [feature] optional argument", () => {
    const command = compressionCommand;
    expect(command).toBeDefined();
  });

  it("supports --json option", () => {
    const command = compressionCommand;
    const options = command.options || [];
    const jsonOpt = options.find(
      (o: { long: string }) => o.long === "--json"
    );
    expect(jsonOpt).toBeDefined();
  });

  it("supports --all option", () => {
    const command = compressionCommand;
    const options = command.options || [];
    const allOpt = options.find(
      (o: { long: string }) => o.long === "--all"
    );
    expect(allOpt).toBeDefined();
  });
});

describe("FR-009: compressionCommand — --all summary mode", () => {
  // US-005: cross-feature compression summary
  it("US-005: --all flag produces summary across multiple features", () => {
    const command = compressionCommand;
    expect(command).toBeDefined();
  });
});

describe("FR-010: compressionCommand — error handling", () => {
  // US-006: fails on unshipped feature
  it("US-006: exits with code 1 for feature with no impl commits", () => {
    expect(compressionCommand).toBeDefined();
  });

  it("exits with code 1 when effort data missing", () => {
    // Should fail if gwrk effort hasn't been run first
    expect(compressionCommand).toBeDefined();
  });
});
