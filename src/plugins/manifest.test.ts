import { describe, expect, it } from "vitest";
// @ts-ignore - Module does not exist yet (RED)
import { AnyManifestSchema, SkillManifestSchema, AgentManifestSchema, WorkflowManifestSchema } from "./manifest.js";

describe("FR-002 / FR-013 / FR-L1-001 / FR-L25-001: Manifest Schema Validation", () => {
  describe("Skill Manifests", () => {
    it("US-001: validates a valid atomic skill manifest (DM-001)", () => {
      const validAtomic = {
        type: "skill",
        name: "narrative",
        tier: "atomic",
        version: "1.0.0",
        description: "Produces a narrative arc from a brief.",
        category: "reasoning",
        prompt: "You are an expert storyteller...",
        interface: {
          input: "stdin",
          output: "stdout",
          exitCodes: { 0: "Success", 1: "Failure" }
        },
        runtime: {
          preferredAgent: "claude",
          preferredModel: "claude-3-opus",
          maxInputTokens: 4096
        }
      };
      expect(SkillManifestSchema.parse(validAtomic)).toEqual(validAtomic);
    });

    it("US-001: validates a valid compound skill manifest (DM-002)", () => {
      const validCompound = {
        type: "skill",
        name: "signal-cut",
        tier: "compound",
        version: "1.0.0",
        description: "Multi-pass refinement.",
        composes: ["narrative", "practitioner"],
        passes: [
          { name: "Draft", skill: "narrative", summary: "Initial draft" },
          { name: "Refine", skill: "practitioner", summary: "Add practical details" }
        ],
        interface: {
          input: "stdin",
          output: "stdout",
          exitCodes: { 0: "Success" }
        },
        runtime: {
          preferredAgent: "gemini",
          preferredModel: "gemini-1.5-pro",
          maxInputTokens: 8192
        }
      };
      expect(SkillManifestSchema.parse(validCompound)).toEqual(validCompound);
    });
  });

  describe("Agent Manifests", () => {
    it("US-L1-001: validates a valid agent manifest (FR-L1-001)", () => {
      const validAgent = {
        type: "agent",
        name: "gemini-local",
        version: "1.0.0",
        description: "Local Gemini CLI adapter",
        dispatchMode: "local-cli",
        contextFileName: "GEMINI.md",
        invocation: {
          command: "gemini",
          args: ["--yolo", "-p"],
          model: "gemini-1.5-pro"
        },
        capabilities: ["multi-file", "tool-use"],
        models: { "pro": "gemini-1.5-pro", "flash": "gemini-1.5-flash" },
        exitCodeMap: { 0: { exitCode: 0 }, 53: { exitCode: 1, errorType: "turn_limit" } }
      };
      expect(AgentManifestSchema.parse(validAgent)).toEqual(validAgent);
    });
  });

  describe("Workflow Manifests", () => {
    it("FR-L25-001: validates a valid workflow manifest", () => {
      const validWorkflow = {
        type: "workflow",
        name: "specify",
        version: "1.0.0",
        description: "Generate feature specifications",
        outputSchema: {
          type: "object",
          properties: {
            spec: { type: "string" }
          }
        }
      };
      expect(WorkflowManifestSchema.parse(validWorkflow)).toEqual(validWorkflow);
    });
  });

  describe("Negative Paths", () => {
    it("FR-001: rejects missing required fields", () => {
      const invalid = { type: "skill", name: "incomplete" };
      expect(() => SkillManifestSchema.parse(invalid)).toThrow();
    });

    it("FR-001: rejects unknown plugin types", () => {
      const invalid = { type: "invalid-type", name: "foo", version: "1.0.0" };
      expect(() => AnyManifestSchema.parse(invalid)).toThrow();
    });

    it("FR-L1-009: rejects invalid names (not kebab-case)", () => {
      const invalid = {
        type: "skill",
        name: "Invalid_Name",
        version: "1.0.0",
        tier: "atomic",
        description: "Foo"
      };
      expect(() => SkillManifestSchema.parse(invalid)).toThrow(/kebab-case/);
    });

    it("TC-010: rejects Agent manifests with invalid dispatchMode", () => {
        const invalid = {
            type: "agent",
            name: "bad-agent",
            version: "1.0.0",
            description: "Bad",
            dispatchMode: "invalid-mode"
        };
        expect(() => AgentManifestSchema.parse(invalid)).toThrow();
    });
  });
});
