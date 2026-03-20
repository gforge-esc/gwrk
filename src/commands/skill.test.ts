import { Command } from "commander";
import { describe, expect, it, vi, beforeEach } from "vitest";
// @ts-ignore - Module does not exist yet (RED)
import { skillCommand } from "./skill.js";

describe("FR-006 / FR-007 / FR-010: Skill CLI Command", () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.addCommand(skillCommand);
    vi.clearAllMocks();
  });

  describe("gwrk skill <name> (FR-006 / US-005)", () => {
    it("invokes a skill with stdin as input", async () => {
      // program.parseAsync(['skill', 'narrative'])
      await program.parseAsync(['skill', 'narrative']);
      // If it reaches here without error, we need more assertions in implementation phase
    });

    it("errors if skill does not exist (FR-006 / US-005)", async () => {
      await expect(program.parseAsync(['skill', 'nonexistent'])).rejects.toThrow(/Skill 'nonexistent' not found/);
    });
  });

  describe("F013 Contract (FR-007 / US-005)", () => {
    it("supports --format json for structured output", async () => {
      await program.parseAsync(['skill', 'narrative', '--format', 'json']);
    });

    it("supports --agent mode for ANSI stripping", async () => {
      await program.parseAsync(['skill', 'narrative', '--agent']);
    });
  });

  describe("Help Commands (FR-010 / US-008)", () => {
    it("lists all skills with 'gwrk skill --help'", async () => {
      // Commander usually exits or captures help. 
      // This will fail because command doesn't exist yet.
      await program.parseAsync(['skill', '--help']);
    });
  });
});
