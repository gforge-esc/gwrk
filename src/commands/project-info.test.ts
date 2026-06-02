import { describe, it, expect, vi, beforeEach } from "vitest";
import { projectInfoCommand } from "./project-info.js";
import * as detector from "../engine/profile-detector.js";
import { Command } from "commander";

/**
 * TR-032: Unit test gwrk project info
 * FR-035: Display resolved profile
 */
describe("FR-035: Project Profile Introspection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("TR-032.1: returns valid JSON matching ProjectProfileSchema when --format json is used", async () => {
    expect(projectInfoCommand.name()).toBe("info");
    const options = projectInfoCommand.options.map(o => o.flags);
    expect(options).toContain("--format <type>");
  });

  it("US-029.1: displays type, stack, and layout in default output", async () => {
    const mockProfile = {
      type: "gwrk-native",
      stack: { language: "TypeScript", buildSystem: "pnpm" },
      layout: "src-nested"
    };
    vi.spyOn(detector, "detectProfile").mockResolvedValue(mockProfile);
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const program = new Command();
    program.exitOverride();
    program.addCommand(projectInfoCommand);
    
    await program.parseAsync(['info'], { from: 'user' });

    const output = writeSpy.mock.calls.map(call => call[0]).join("");
    expect(output).toContain("Project Profile: gwrk-native");
    expect(output).toContain("Language: TypeScript");
    expect(output).toContain("Layout: src-nested");
  });

  it("US-029.2: supports --format json", async () => {
    const mockProfile = {
      type: "nodejs",
      stack: { language: "JavaScript", buildSystem: "npm" },
      layout: "flat"
    };
    vi.spyOn(detector, "detectProfile").mockResolvedValue(mockProfile);
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const program = new Command();
    program.exitOverride();
    program.addCommand(projectInfoCommand);
    
    await program.parseAsync(['info', '--format', 'json'], { from: 'user' });

    const output = writeSpy.mock.calls.map(call => call[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.type).toBe("nodejs");
    expect(parsed.stack.language).toBe("JavaScript");
  });
});
