/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * 023-plan-format-contract — Phase 2 (generator emits the canonical format).
 *
 * RED doc-contract test for FR-005 / US-005 (TR-006). Grep-asserts that the
 * `gwrk-plan` generator prompt documents the canonical output shape the parser
 * (Phase 1) recognizes: a fenced ```bash `#### Done When` block and em-dash file
 * lines with `action ∈ {create, amend, delete}`. This locks generator↔parser
 * drift in CI.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROMPT = fs.readFileSync(path.join(HERE, "PROMPT.md"), "utf-8");

describe("FR-005: gwrk-plan prompt documents the canonical format", () => {
  it("documents the fenced-bash Done-When block as the executable gate form", () => {
    // A `#### Done When`/`Done When` section whose body is a fenced ```bash
    // block — the only executable form. The current prompt only bolds
    // "**Done When**" prose and has no bash fence tied to it (RED).
    expect(PROMPT).toMatch(/Done When[\s\S]{0,800}```bash/i);
  });

  it("documents em-dash file lines with action ∈ {create, amend, delete}", () => {
    // Mirrors the spec grep: 'action.*create.*amend.*delete' | '— **action** —'.
    expect(PROMPT).toMatch(
      /create[\s\S]{0,120}amend[\s\S]{0,120}delete|—\s*\*\*(?:action|create|amend|delete)\*\*\s*—/i,
    );
  });
});
