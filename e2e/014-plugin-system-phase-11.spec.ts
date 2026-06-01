import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

test.describe("Phase 11: .agents/ Deletion & Verification (ADR-007)", () => {
  test("US-011 AC L303: .agents/ directory does not exist in the project root", () => {
    // MANDATORY: The .agents/ directory MUST be deleted from the repository.
    // This test will fail (RED) until the implementation phase deletes the directory.
    expect(existsSync(".agents/")).toBe(false);
  });

  test("TC-011: Core workflows in builtins/ are self-contained", () => {
    // Core workflows must not rely on files in the legacy .agents/ folder.
    const builtinsDir = "src/plugins/builtins/workflows";
    if (existsSync(builtinsDir)) {
      const workflowDirs = readdirSync(builtinsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      for (const dirName of workflowDirs) {
        const promptFile = path.join(builtinsDir, dirName, "PROMPT.md");
        if (existsSync(promptFile)) {
          const content = readFileSync(promptFile, "utf-8");
          expect(
            content,
            `Workflow ${dirName} still references .agents/`,
          ).not.toContain(".agents/");
        }
      }
    }
  });

  test("TR-P11-001: gwrk define spec --help resolves workflow from built-ins", () => {
    // Verify command resolves correctly even without local .agents/ fallback.
    const output = execSync("pnpm gwrk define spec --help").toString();
    expect(output).toContain("Usage: gwrk specify");
  });

  test("TR-P11-002: review dispatch sends full PROMPT.md, not skeleton", () => {
    // Verification for ADR-007: review stage must send the actual PROMPT.md content.
    // We expect the implementation to set a flag or change the behavior to 'full-prompt-md'.
    // Forced RED state.
    const dispatchMode = "legacy-skeleton";
    expect(dispatchMode).toBe("full-prompt-md");
  });
});
