import { describe, it, expect } from "vitest";
import { conditionPrompt } from "./prompt-conditioner.js";

/**
 * TR-031: Unit test prompt conditioning
 * FR-033: Inject <project_profile> XML block
 * FR-034: Refactor PROMPT.md with conditional guards
 */
describe("FR-033: Project-Aware Prompt Conditioning", () => {
  it("TR-031.1: injects <project_profile> XML block into prompt", () => {
    const prompt = "Act as a software engineer.";
    const profile = {
      type: "pnpm-monorepo",
      stack: {
        language: "typescript",
        framework: "react",
      },
      layout: {
        apps: "apps",
        packages: "packages",
      },
    };

    const conditioned = conditionPrompt(prompt, profile);
    expect(conditioned).toContain("<project_profile>");
    expect(conditioned).toContain('type="pnpm-monorepo"');
    expect(conditioned).toContain("Act as a software engineer.");
  });

  it("TR-031.2: gwrk-native profile preserves ADR-004/Commander.js sections", () => {
    const prompt = "Gated section: [type: gwrk-native] ADR-004 logic [/type]";
    const profile = {
      type: "gwrk-native",
    };

    const conditioned = conditionPrompt(prompt, profile);
    expect(conditioned).toContain("ADR-004 logic");
  });

  it("TR-031.3: non-gwrk profile omits gwrk-native sections", () => {
    const prompt = "Gated section: [type: gwrk-native] ADR-004 logic [/type] General info.";
    const profile = {
      type: "generic",
    };

    const conditioned = conditionPrompt(prompt, profile);
    expect(conditioned).not.toContain("ADR-004 logic");
    expect(conditioned).toContain("General info.");
  });

  it("TR-031.4: omits <project_profile> if profile is unknown", () => {
    const prompt = "Test prompt";
    const conditioned = conditionPrompt(prompt, { type: "unknown" });
    expect(conditioned).not.toContain("<project_profile>");
    expect(conditioned).toBe("Test prompt");
  });
});
