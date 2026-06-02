import { describe, it, expect } from "vitest";
import { conditionPrompt } from "./prompt-conditioner.js";
import fs from "node:fs";
import path from "node:path";

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

    const conditioned = conditionPrompt(prompt, profile as any);
    expect(conditioned).toContain("<project_profile");
    expect(conditioned).toContain('type="pnpm-monorepo"');
    expect(conditioned).toContain('<layout apps="apps" packages="packages" />');
    expect(conditioned).toContain("Act as a software engineer.");
  });

  it("TR-031.1c: injects <project_profile> with string layout", () => {
    const prompt = "Test";
    const profile = {
      type: "pnpm-monorepo",
      layout: "monorepo",
    };

    const conditioned = conditionPrompt(prompt, profile);
    expect(conditioned).toContain('<layout type="monorepo" />');
  });

  it("TR-031.2: gwrk-native profile preserves ADR-004/Commander.js sections with whitespace", () => {
    const prompt = "Gated section:\n[type: gwrk-native]\nADR-004 logic\n[/type]";
    const profile = {
      type: "gwrk-native",
    };

    const conditioned = conditionPrompt(prompt, profile);
    expect(conditioned).toContain("Gated section:\n\nADR-004 logic");
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

describe("FR-034: PROMPT.md Refactoring Guards", () => {
  it("should have zero ungated gwrk-specific terms in PROMPT.md files", () => {
    // This is a "meta-test" that verifies the refactoring requirement.
    // It should fail until the PROMPT.md files are refactored.
    const workflowDirs = fs.readdirSync("src/plugins/builtins/workflows");
    const ungatedTerms = ["src/commands", "src/engine", "ADR-004", "Commander.js", "better-sqlite3"];
    
    let totalUngatedMatches = 0;
    for (const dir of workflowDirs) {
      const promptPath = path.join("src/plugins/builtins/workflows", dir, "PROMPT.md");
      if (fs.existsSync(promptPath)) {
        const content = fs.readFileSync(promptPath, "utf-8");
        // Remove all gated blocks to see what's left "in the open"
        const ungatedContent = content.replace(/\[type:\s*[^\]]*gwrk-native[^\]]*\][\s\S]*?\[\/type\]/g, "");
        
        for (const term of ungatedTerms) {
          const regex = new RegExp(`${term.replace(".", "\\.")}`, "g");
          const matches = ungatedContent.match(regex);
          if (matches) {
            // console.log(`Ungated match in ${dir}: ${term}`);
            totalUngatedMatches += matches.length;
          }
        }
      }
    }
    
    expect(totalUngatedMatches, "Ungated gwrk-specific terms found in PROMPT.md files").toBe(0);
  });
});
