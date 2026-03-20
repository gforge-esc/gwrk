import fs from "node:fs";
import { Command } from "commander";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { skillCommand } from "./skill.js";
import * as skillRuntime from "../plugins/skill-runtime.js";

vi.mock("../plugins/skill-runtime.js", () => ({
  executeSkill: vi.fn().mockResolvedValue({
    stdout: "Mocked output",
    stderr: "Mocked error\n[exit:0 | 0.1s]",
    exitCode: 0,
    durationS: 0.1
  })
}));

describe("FR-006 / FR-007 / FR-010: Skill CLI Command", () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.addCommand(skillCommand);
    vi.clearAllMocks();
    
    // Mock stdin/TTY to avoid hanging
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      configurable: true,
      writable: true
    });
    vi.spyOn(fs, 'readFileSync').mockReturnValue("");

    // Mock process.stdout.write and process.stderr.write
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    // Mock process.exit to avoid exiting the test process
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  describe("gwrk skill <name> (FR-006 / US-005)", () => {
    it("invokes a skill", async () => {
      await program.parseAsync(['node', 'gwrk', 'skill', 'narrative']);
      expect(skillRuntime.executeSkill).toHaveBeenCalledWith('narrative', expect.any(Object));
      expect(process.stdout.write).toHaveBeenCalledWith("Mocked output");
    });

    it("errors if skill does not exist (FR-006 / US-005)", async () => {
      vi.mocked(skillRuntime.executeSkill).mockRejectedValueOnce(new Error("Plugin 'nonexistent' not found"));
      await program.parseAsync(['node', 'gwrk', 'skill', 'nonexistent']);
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe("F013 Contract (FR-007 / US-005)", () => {
    it("supports --format json for structured output", async () => {
      await program.parseAsync(['node', 'gwrk', 'skill', 'narrative', '--format', 'json']);
      expect(skillRuntime.executeSkill).toHaveBeenCalledWith('narrative', expect.objectContaining({ format: 'json' }));
    });

    it("supports --agent mode for ANSI stripping", async () => {
      await program.parseAsync(['node', 'gwrk', 'skill', 'narrative', '--agent']);
      expect(skillRuntime.executeSkill).toHaveBeenCalledWith('narrative', expect.objectContaining({ agent: true }));
    });

    it("preserves signals on stderr when piped (TR-008)", async () => {
      // In a real pipe, we'd check if stderr of first process reaches the terminal.
      // Here we just check if it was written to stderr.
      await program.parseAsync(['node', 'gwrk', 'skill', 'narrative']);
      expect(process.stderr.write).toHaveBeenCalledWith(expect.stringMatching(/\[exit:0 \| \d+(\.\d+)?s\]/));
    });
  });
});
