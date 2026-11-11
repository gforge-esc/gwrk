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

  it("uses the project's verification and validation standards", () => {
    const persona = readFileSync(
      new URL("./builtins/personas/principal-engineer.md", import.meta.url),
      "utf8",
    );
    expect(persona).not.toMatch(/run `make up`|Zod everywhere/i);
    expect(persona).toMatch(/project.{0,30}(?:verification|test) command/i);
  });
});
