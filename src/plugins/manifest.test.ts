import { describe, expect, it } from "vitest";
import {
  AgentManifestSchema,
  AnyManifestSchema,
  AtomicSkillManifestSchema,
  CompoundSkillManifestSchema,
  WorkflowManifestSchema,
} from "./manifest.js";

describe("Plugin Manifest Schemas", () => {
  describe("AtomicSkillManifestSchema", () => {
    it("should validate a valid atomic skill manifest", () => {
      const validAtomic = {
        type: "skill",
        tier: "atomic",
        name: "truth-extract",
        version: "1.0.0",
        description: "Extract truth from noise",
        category: "reasoning",
        prompt: "Work backward from claims to evidence...",
        interface: {
          input: "stdin",
          output: "stdout",
          flags: [{ name: "--depth", description: "Search depth" }],
        },
        runtime: {
          preferredAgent: "gemini",
          preferredModel: "gemini-2.0-flash",
        },
      };

      const result = AtomicSkillManifestSchema.safeParse(validAtomic);
      expect(result.success).toBe(true);
    });

    it("should reject invalid kebab-case names", () => {
      const invalid = {
        type: "skill",
        tier: "atomic",
        name: "Truth_Extract",
        version: "1.0.0",
        description: "desc",
        category: "reasoning",
        prompt: "prompt",
        interface: { input: "stdin", output: "stdout" },
        runtime: { preferredAgent: "a", preferredModel: "b" },
      };
      const result = AtomicSkillManifestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe("CompoundSkillManifestSchema", () => {
    it("should validate a valid compound skill manifest", () => {
      const validCompound = {
        type: "skill",
        tier: "compound",
        name: "signal-cut",
        version: "0.1.0",
        description: "Marketing content that converts",
        composes: ["narrative", "practitioner"],
        passes: [
          {
            name: "narrative-pass",
            skill: "narrative",
            summary: "Apply narrative arc",
          },
        ],
        interface: { input: "stdin", output: "stdout" },
        context: {
          required: ["input", "product"],
          optional: ["audience"],
        },
        runtime: {
          preferredAgent: "claude",
          preferredModel: "claude-3-5-sonnet",
        },
      };

      const result = CompoundSkillManifestSchema.safeParse(validCompound);
      expect(result.success).toBe(true);
    });
  });

  describe("AgentManifestSchema", () => {
    it("should validate a valid agent manifest", () => {
      const validAgent = {
        type: "agent",
        name: "gemini-cli",
        version: "1.2.3",
        description: "Google Gemini CLI adapter",
        dispatchMode: "local-cli",
        contextFileName: "GEMINI.md",
        invocation: {
          command: "gemini",
          args: ["--yolo"],
          headlessFlag: "--headless",
        },
        capabilities: ["shell", "files"],
        models: {
          pro: "gemini-1.5-pro",
          flash: "gemini-1.5-flash",
        },
        exitCodeMap: {
          "0": { exitCode: 0 },
          "1": { exitCode: 1, errorType: "GENERIC" },
          "53": { exitCode: 1, errorType: "SAFETY" },
        },
        managedConfig: [
          { path: "~/.config/gemini/config.json", keys: ["api_key"] },
        ],
      };

      const result = AgentManifestSchema.safeParse(validAgent);
      expect(result.success).toBe(true);
    });
  });

  describe("WorkflowManifestSchema", () => {
    it("should validate a valid workflow manifest", () => {
      const validWorkflow = {
        type: "workflow",
        name: "feature-implement",
        version: "0.5.0",
        description: "Implement a feature from spec",
        outputSchema: {
          type: "object",
          properties: {
            action: { type: "string" },
            filePath: { type: "string" },
          },
        },
      };

      const result = WorkflowManifestSchema.safeParse(validWorkflow);
      expect(result.success).toBe(true);
    });
  });

  describe("AnyManifestSchema (Discriminated Union)", () => {
    it("should resolve different types correctly", () => {
      const atomic = {
        type: "skill",
        tier: "atomic",
        name: "test",
        version: "1.0.0",
        description: "test",
        category: "meta",
        prompt: "test",
        interface: { input: "stdin", output: "stdout" },
        runtime: { preferredAgent: "a", preferredModel: "b" },
      };

      const agent = {
        type: "agent",
        name: "test-agent",
        version: "1.0.0",
        description: "test",
        dispatchMode: "local-cli",
        contextFileName: "TEST.md",
        capabilities: [],
        models: {},
        exitCodeMap: {},
      };

      expect(AnyManifestSchema.safeParse(atomic).success).toBe(true);
      expect(AnyManifestSchema.safeParse(agent).success).toBe(true);
    });

    it("should reject unknown types", () => {
      const unknown = {
        type: "not-a-type",
        name: "test",
        version: "1.0.0",
        description: "test",
      };
      // @ts-expect-error - testing invalid input
      const result = AnyManifestSchema.safeParse(unknown);
      expect(result.success).toBe(false);
    });
  });
});
