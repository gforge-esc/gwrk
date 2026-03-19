import { describe, it, expect } from "vitest";
import { 
  AtomicManifestSchema, 
  CompoundManifestSchema, 
  AgentManifestSchema, 
  AnyManifestSchema 
} from "./manifest";

describe("FR-002: Plugin Manifest Validation", () => {
  describe("Atomic Skill Manifest", () => {
    it("US-005: should validate a valid atomic skill manifest", () => {
      const validAtomic = {
        type: "skill",
        name: "narrative",
        tier: "atomic",
        version: "1.0.0",
        description: "Generates narrative arcs",
        category: "reasoning",
        prompt: "You are a narrative expert...",
        interface: {
          input: "stdin",
          output: "stdout",
          exitCodes: {
            0: "Success",
            1: "Failure"
          }
        },
        runtime: {
          preferredAgent: "gemini",
          preferredModel: "gemini-2.0-flash",
          maxInputTokens: 8192
        }
      };
      const result = AtomicManifestSchema.safeParse(validAtomic);
      expect(result.success).toBe(true);
    });

    it("should reject an atomic skill manifest with missing fields", () => {
      const invalidAtomic = {
        type: "skill",
        name: "narrative",
        tier: "atomic"
        // missing version, prompt, etc.
      };
      const result = AtomicManifestSchema.safeParse(invalidAtomic);
      expect(result.success).toBe(false);
    });
  });

  describe("Compound Skill Manifest", () => {
    it("US-006: should validate a valid compound skill manifest", () => {
      const validCompound = {
        type: "skill",
        name: "signal-cut",
        tier: "compound",
        version: "1.0.0",
        description: "Multi-pass content filter",
        composes: ["narrative", "truth-extract"],
        passes: [
          { name: "First Pass", skill: "truth-extract", summary: "Extract facts" },
          { name: "Second Pass", skill: "narrative", summary: "Apply arc" }
        ],
        interface: {
          input: "stdin",
          output: "stdout",
          exitCodes: { 0: "Success" }
        },
        runtime: {
          preferredAgent: "claude",
          preferredModel: "claude-3-5-sonnet",
          maxInputTokens: 16384
        }
      };
      const result = CompoundManifestSchema.safeParse(validCompound);
      expect(result.success).toBe(true);
    });
  });

  describe("Agent Manifest", () => {
    it("US-L1-001: should validate a valid agent manifest (ADR-006)", () => {
      const validAgent = {
        type: "agent",
        name: "gemini-adapter",
        version: "1.0.0",
        description: "Gemini CLI adapter",
        dispatchMode: "local-cli",
        contextFileName: "GEMINI.md",
        invocation: {
          command: "gemini",
          args: ["--yolo"],
          modelFlag: "--model"
        },
        capabilities: ["multi-file", "tool-use"],
        models: {
          "pro": "gemini-1.5-pro",
          "flash": "gemini-1.5-flash"
        },
        exitCodeMap: {
          "0": { code: 0 },
          "53": { code: 1, errorType: "turn_limit" }
        }
      };
      const result = AgentManifestSchema.safeParse(validAgent);
      expect(result.success).toBe(true);
    });
  });

  describe("AnyManifestSchema (Discriminated Union)", () => {
    it("should resolve the correct schema based on 'type' and 'tier'", () => {
      const skill = {
        type: "skill",
        name: "test",
        tier: "atomic",
        version: "1.0.0",
        description: "test",
        category: "test",
        prompt: "test",
        interface: { input: "stdin", output: "stdout", exitCodes: {} },
        runtime: { preferredAgent: "gemini", preferredModel: "test", maxInputTokens: 100 }
      };
      expect(AnyManifestSchema.safeParse(skill).success).toBe(true);

      const agent = {
        type: "agent",
        name: "test-agent",
        version: "1.0.0",
        description: "test",
        dispatchMode: "local-cli",
        contextFileName: "TEST.md",
        capabilities: [],
        models: {},
        exitCodeMap: {}
      };
      expect(AnyManifestSchema.safeParse(agent).success).toBe(true);
    });

    it("FR-001: should reject unknown plugin types", () => {
      const unknown = {
        type: "coffee-maker",
        name: "espresso",
        version: "1.0.0"
      };
      // @ts-expect-error - testing invalid type
      const result = AnyManifestSchema.safeParse(unknown);
      expect(result.success).toBe(false);
    });
  });
});
