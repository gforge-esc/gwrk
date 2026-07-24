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
 *
 * 024-gate-assertion-contract — Phase 1 (generator assertion contract).
 *
 * Adds RED doc-contract tests for FR-001 / US-001 (TR-001) and FR-002 / US-002
 * (TR-002). These assert the §4a `#### Done When` guidance documents (a) that a
 * Done-When line verifying a command asserts on that command's EXIT CODE by
 * running it directly, and (b) that the `<cmd> | grep -q <pattern>` output-as-pass
 * antipattern is explicitly forbidden — with the failure reason and the
 * capture-to-file-then-`grep -q <file>` safe alternative. The named `it` targets
 * (`"exit-based Done-When assertion"`, `"forbids output-as-pass grep"`) match the
 * exact `-t` selectors the spec's acceptance scenarios invoke. RED until the
 * implementing agent amends PROMPT.md (contract §1 Rules 1–3).
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

describe("FR-001: gwrk-plan prompt requires exit-based Done-When assertions", () => {
  // US-001 acceptance: `grep -qiE 'exit code|exit status' PROMPT.md` exits 0, and
  // `pnpm vitest run … -t "exit-based Done-When assertion"` exits 0.
  it("exit-based Done-When assertion", () => {
    // (1) The whole-file grep the US-001 AC1 runs (contract §1 Rule 1 doc-check).
    expect(PROMPT).toMatch(/exit code|exit status/i);

    // (2) The exit-code guidance lives INSIDE the `#### Done When` output
    // contract (§4a), not some unrelated prose — assert proximity so a stray
    // mention elsewhere can't satisfy the contract.
    expect(PROMPT).toMatch(/Done When[\s\S]{0,2000}(exit code|exit status)/i);

    // (3) The canonical way to prove a command succeeded is to RUN IT DIRECTLY
    // (its non-zero exit fails the gate under Layer 2's set -e), shown with a
    // bare-command example — NOT an output grep. FR-001 forbids presenting
    // output-text matching as proof of success.
    expect(PROMPT).toMatch(
      /run(?:ning|s)?\s+(?:it|the command|them)\s+directly|assert(?:s|ing)?\s+on\s+(?:the\s+|its\s+|that\s+command'?s?\s+)?exit/i,
    );
  });
});

describe("FR-002: gwrk-plan prompt forbids the output-as-pass antipattern", () => {
  // US-002 acceptance: `grep -qiE 'grep -q' PROMPT.md` exits 0, a forbid directive
  // exists, and `pnpm vitest run … -t "forbids output-as-pass grep"` exits 0.
  it("forbids output-as-pass grep", () => {
    // (a) The antipattern is named (US-002 AC1: grep -qiE 'grep -q').
    expect(PROMPT).toMatch(/grep -q/);

    // (b) A forbid/never/do-not/antipattern directive exists (US-002 AC1).
    expect(PROMPT).toMatch(/forbid|never|do not|don't|antipattern/i);

    // (c) The directive sits ADJACENT to the `<cmd> | grep -q` form it forbids —
    // not floating in unrelated prose (contract §1 Rule 2 doc-check).
    expect(PROMPT).toMatch(
      /(?:forbid|never|do not|don't|antipattern)[\s\S]{0,700}\|\s*grep\b[^|\n]*-q|\|\s*grep\b[^|\n]*-q[\s\S]{0,700}(?:forbid|never|do not|don't|antipattern)/i,
    );

    // (d) The FAILURE REASON is documented: on failure the pattern surfaces in
    // the command's error output; with set -e and no pipefail only the trailing
    // grep -q's exit decides, masking the producer's non-zero exit → false green.
    expect(PROMPT).toMatch(
      /error output|stderr|pipefail|mask(?:s|ing|ed)?|false[- ]?green/i,
    );

    // (e) The SAFE ALTERNATIVE is documented: capture output to a file as a
    // separate step, then `grep -q <pattern> <file>` (grep reads a file, never a
    // command's mixed stdout/stderr pipe). A file-argument grep remains allowed.
    expect(PROMPT).toMatch(
      /capture[\s\S]{0,300}\bfile\b|grep -q[^|\n]*\bfile\b|grep -q\s+\S+\s+\S+\.\w+/i,
    );
  });
});
