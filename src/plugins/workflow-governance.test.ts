/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { conditionPrompt } from "../domain/prompt-conditioner.js";

const workflow = (name: string) =>
  readFileSync(
    new URL(`./builtins/workflows/${name}/PROMPT.md`, import.meta.url),
    "utf8",
  );

describe("workflow architecture guidance", () => {
  it.each(["gwrk-specify", "gwrk-plan"])(
    "describes the current gwrk layers in %s",
    (name) => {
      const prompt = conditionPrompt(workflow(name), {
        type: "pnpm-monorepo",
        _isGwrk: true,
        stack: { language: "TypeScript" },
      });
      for (const layer of [
        "src/domain/",
        "src/ports/",
        "src/application/",
        "src/adapters/",
      ]) {
        expect(prompt).toContain(layer);
      }
    },
  );

  it.each(["gwrk-specify", "gwrk-plan"])(
    "does not impose gwrk folders on a Python project in %s",
    (name) => {
      const prompt = conditionPrompt(workflow(name), {
        type: "python",
        stack: { language: "Python", framework: "FastAPI" },
        layout: "src-layout",
      });
      expect(prompt).toContain('language="Python"');
      expect(prompt).toContain('type="src-layout"');
      expect(prompt).not.toMatch(/src\/(?:cli\.ts|engine\/|adapters\/)/);
    },
  );

  it("uses gwrk documentation and gate commands for a native plan", () => {
    const prompt = conditionPrompt(workflow("gwrk-plan"), {
      type: "pnpm-monorepo",
      _isGwrk: true,
      stack: { language: "TypeScript" },
    });
    expect(prompt).toContain("`docs/grounding/architecture.md`");
    expect(prompt).toContain(
      "#### Done When\n```bash\npnpm run build\npnpm vitest run path/to/phase.test.ts\n```",
    );
    expect(prompt).toContain(
      '```bash\n  pnpm vitest run path/to/phase.test.ts > out.log\n  grep -q "expected pattern" out.log\n  ```',
    );
    expect(prompt).not.toContain("pytest");
  });

  it("uses host documentation and gate commands for a Python plan", () => {
    const prompt = conditionPrompt(workflow("gwrk-plan"), {
      type: "python",
      stack: { language: "Python", framework: "FastAPI" },
      layout: "src-layout",
    });
    expect.soft(prompt).toMatch(/Read the host repository's architecture/);
    expect
      .soft(prompt)
      .toContain("Use the host repository's verification commands");
    expect.soft(prompt).not.toContain("docs/grounding/architecture.md");
    expect.soft(prompt).not.toMatch(/\bpnpm\b/);
    expect.soft(prompt).toContain(
      "#### Done When\n```bash\npython -m pytest tests/test_phase.py\n```",
    );
    expect.soft(prompt).toContain(
      '```bash\n  python -m pytest tests/test_phase.py > out.log\n  grep -q "expected pattern" out.log\n  ```',
    );
  });

  it("uses the project's verification and validation standards", () => {
    const persona = readFileSync(
      new URL("./builtins/personas/principal-engineer.md", import.meta.url),
      "utf8",
    );
    expect(persona).not.toMatch(/run `make up`|Zod everywhere/i);
    expect(persona).toMatch(
      /project's verification commands and schema validation standards/i,
    );
    const output = persona.split("\n# Output\n")[1];
    expect.soft(output).toMatch(
      /\bstart every PR comment with `\*\*From: Principal Engineer\*\*`/i,
    );
    expect.soft(output).toMatch(
      /\btag `@\[PROJECT_LEAD\]` when (?:the )?rules, guardrails or architecture are ambiguous/i,
    );
  });
});
