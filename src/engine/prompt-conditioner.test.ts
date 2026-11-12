/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

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


describe("FR-001: architecture metadata in prompts (044 phase p01)", () => {
  it.each(["nodejs", "gwrk-native", "polyglot-monorepo"])("TR-006: renders design inside project context for %s", (type) => {
    const design = {
      architecture: "hexagonal-functional",
      principles: ["functional-core", "clean-code", "tdd"],
      templateVersion: "1.0.0",
    };
    const profile = { type, design, stack: { language: "TypeScript" } };
    const result = conditionPrompt("Inspect ports.", profile);
    const context = result.match(/<project_context\b[^>]*>([\s\S]*?)<\/project_context>/)?.[1];
    expect(context).toBeDefined();
    const block = context?.match(/<design\b[^>]*>[\s\S]*?<\/design>/)?.[0];
    expect(block).toBeDefined();
    for (const value of [design.architecture, ...design.principles]) expect(block).toContain(value);
    expect(result.match(/<design\b/g)).toHaveLength(1);
    expect(result).toContain("Inspect ports.");
  });

  it.each([
    ["React & Vite", "React &amp; Vite"],
    ['React & "Vite"', "React &amp; &quot;Vite&quot;"],
  ])("escapes framework %s inside project context", (framework, escaped) => {
    const result = conditionPrompt("Inspect ports.", {
      type: "nodejs",
      design: { architecture: "layered", principles: [], templateVersion: "1.0.0" },
      stack: { framework },
    });
    const context = result.match(/<project_context>([\s\S]*?)<\/project_context>/)?.[1];
    expect(context).toContain(`framework="${escaped}"`);
    expect(context).toContain("<architecture>layered</architecture>");
  });

  it("TR-006: does not leak selected design into a later unconfigured prompt", () => {
    const selected = { type: "nodejs", design: { architecture: "layered", principles: [], templateVersion: "1.0.0" } };
    const withDesign = conditionPrompt("Selected", selected);
    const withoutDesign = conditionPrompt("Legacy", { type: "nodejs" });
    expect(withoutDesign).toBe('<project_profile type="nodejs">\n</project_profile>\n\nLegacy');
    expect(withoutDesign).not.toMatch(/<design\b/);
    expect(withDesign.match(/<design\b[^>]*>[\s\S]*?<\/design>/)?.[0]).toContain("layered");
  });

  it("renders escaped design metadata when the project type is unknown", () => {
    const profile = {
      type: "unknown",
      design: {
        architecture: "Ports & <adapters>",
        principles: [],
        templateVersion: "1.0.0" as const,
      },
    };
    const prompt = "[type: generic]Inspect ports.[/type]";
    const result = conditionPrompt(prompt, profile);
    expect(result).toContain("<architecture>Ports &amp; &lt;adapters&gt;</architecture>");
    expect(result).toContain("</design>\n</project_context>");
    expect(result.endsWith(prompt)).toBe(true);
  });
});
