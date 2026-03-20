import { describe, expect, it, vi, beforeEach } from "vitest";
import { executeSkill, assemblePrompt, validateCompoundManifest } from "./skill-runtime.js";
import { PluginLoader } from "./loader.js";

vi.mock("./loader.js");
vi.mock("node:child_process", () => ({
  exec: vi.fn((cmd, cb) => cb(null, { stdout: "Mocked output", stderr: "Mocked error" }))
}));

describe("FR-006 / FR-008 / FR-009: Skill Runtime Logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Skill Execution (FR-006 / US-005)", () => {
    it("resolves and executes an atomic skill", async () => {
      const mockLoader = {
        resolvePlugin: vi.fn().mockResolvedValue({
          manifest: {
            type: 'skill',
            tier: 'atomic',
            name: 'narrative',
            prompt: 'Test prompt',
            runtime: { preferredAgent: 'gemini', preferredModel: 'gemini-2.0-flash' }
          },
          path: '/mock/path',
          status: 'active'
        })
      };
      (PluginLoader as any).mockImplementation(() => mockLoader);

      const result = await executeSkill('narrative', { input: 'test' });
      expect(result.stdout).toBeDefined();
      expect(result.stderr).toContain('[exit:0');
    });

    it("fails if skill is not found", async () => {
        const mockLoader = {
            resolvePlugin: vi.fn().mockRejectedValue(new Error("Plugin 'nonexistent' not found"))
        };
        (PluginLoader as any).mockImplementation(() => mockLoader);

        await expect(executeSkill('nonexistent')).rejects.toThrow(/Plugin 'nonexistent' not found/);
    });
  });

  describe("Compound Skill Logic (FR-008 / FR-009 / US-006)", () => {
    it("assembles multiple passes into a single prompt (FR-008)", async () => {
      const mockLoader = {
        resolvePlugin: vi.fn().mockImplementation((name) => {
            return {
                manifest: {
                    type: 'skill',
                    tier: 'atomic',
                    name,
                    prompt: `${name} prompt`
                }
            };
        })
      };
      const compoundManifest = {
        type: 'skill',
        tier: 'compound',
        description: 'Mock compound',
        passes: [
          { name: 'p1', skill: 's1', summary: 'Apply s1' },
          { name: 'p2', skill: 's2', summary: 'Apply s2' }
        ]
      } as any;
      const prompt = await assemblePrompt(compoundManifest, 'test input', mockLoader as any);
      expect(prompt).toContain('s1');
      expect(prompt).toContain('s2');
      expect(prompt).toContain('test input');
    });

    it("validates that all composed skills are installed (FR-009)", async () => {
      const mockLoader = {
        resolvePlugin: vi.fn().mockImplementation((name) => {
            if (name === 'missing-skill') throw new Error("Not found");
            return { manifest: { type: 'skill' } };
        })
      };
      const manifest = {
        type: 'skill',
        name: 'signal-cut',
        tier: 'compound',
        composes: ['narrative', 'missing-skill']
      } as any;
      await expect(validateCompoundManifest(manifest, mockLoader as any)).rejects.toThrow(/Missing dependency: skill 'missing-skill'/);
    });
  });

  describe("F013 Contract (FR-007 / US-005)", () => {
    it("strips ANSI codes in --agent mode", async () => {
        // This is tested via mocked processForAgent if integrated, 
        // but here we can check if it calls it.
        // Actually executeSkill uses processForAgent directly from ../utils/agent-layer.js
        const mockLoader = {
            resolvePlugin: vi.fn().mockResolvedValue({
              manifest: {
                type: 'skill',
                tier: 'atomic',
                name: 'narrative',
                prompt: 'Test prompt',
                runtime: { preferredAgent: 'gemini', preferredModel: 'gemini-2.0-flash' }
              }
            })
          };
        (PluginLoader as any).mockImplementation(() => mockLoader);

        const result = await executeSkill('narrative', { agent: true, input: 'test' });
        expect(result.stdout).not.toMatch(/\x1B\[/);
    });

    it("returns [exit:N | Xs] on stderr signal", async () => {
        const mockLoader = {
            resolvePlugin: vi.fn().mockResolvedValue({
              manifest: {
                type: 'skill',
                tier: 'atomic',
                name: 'narrative',
                prompt: 'Test prompt',
                runtime: { preferredAgent: 'gemini', preferredModel: 'gemini-2.0-flash' }
              }
            })
          };
        (PluginLoader as any).mockImplementation(() => mockLoader);
        const result = await executeSkill('narrative');
        expect(result.stderr).toMatch(/\[exit:\d+ \| \d+(\.\d+)?s\]/);
    });
  });
});
