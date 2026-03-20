import { describe, expect, it, vi, beforeEach } from "vitest";
// @ts-ignore - Module does not exist yet (RED)
import { executeSkill, assemblePrompt, validateCompoundManifest } from "./skill-runtime.js";
// @ts-ignore - Module does not exist yet (RED)
import { PluginLoader } from "./loader.js";

vi.mock("./loader.js");

describe("FR-006 / FR-008 / FR-009: Skill Runtime Logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Skill Execution (FR-006 / US-005)", () => {
    it("resolves and executes an atomic skill", async () => {
      const result = await executeSkill('narrative', { input: 'test' });
      expect(result.stdout).toBeDefined();
    });

    it("fails if skill is not found", async () => {
      await expect(executeSkill('nonexistent')).rejects.toThrow(/Skill 'nonexistent' not found/);
    });

    it("fails if no agent backend is available", async () => {
      await expect(executeSkill('narrative')).rejects.toThrow(/No agent backend available/);
    });
  });

  describe("Compound Skill Logic (FR-008 / FR-009 / US-006)", () => {
    it("assembles multiple passes into a single prompt (FR-008)", async () => {
      const compoundManifest = {
        type: 'skill',
        tier: 'compound',
        passes: [
          { name: 'narrative', skill: 'narrative', summary: 'Apply narrative mode' },
          { name: 'practitioner', skill: 'practitioner', summary: 'Apply practitioner mode' }
        ]
      };
      const prompt = await assemblePrompt(compoundManifest, 'test input');
      expect(prompt).toContain('narrative');
      expect(prompt).toContain('practitioner');
      expect(prompt).toContain('test input');
    });

    it("validates that all composed skills are installed (FR-009)", async () => {
      const manifest = {
        type: 'skill',
        tier: 'compound',
        composes: ['narrative', 'missing-skill']
      };
      await expect(validateCompoundManifest(manifest)).rejects.toThrow(/Missing dependency: skill 'missing-skill'/);
    });
  });

  describe("F013 Contract (FR-007 / US-005)", () => {
    it("passes --format json to the agent backend", async () => {
        const result = await executeSkill('narrative', { format: 'json' });
        expect(result).toBeDefined();
    });

    it("strips ANSI codes in --agent mode", async () => {
        const result = await executeSkill('narrative', { agent: true });
        expect(result.stdout).not.toMatch(/\x1B\[/);
    });

    it("returns [exit:N | Xs] on stderr signal", async () => {
        const result = await executeSkill('narrative');
        expect(result.stderr).toMatch(/\[exit:\d+ \| \d+(\.\d+)?s\]/);
    });
  });
});
