/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * 029 Decision Records — RED tests for TR-006 (FR-024, FR-025).
 *
 * @phase 10
 * @status red
 *
 * Runs against a temp fixture tree, never the repo. VR-007 requires observing
 * the checker FAIL as well as pass, so the headline case is driven twice: the
 * phantom `028 correction` unregistered (exit 1, naming `file:line`) and then
 * registered (exit 0). A resolver keyed only on `ADR-\\d+` passes that citation,
 * because ADR-007 resolves — only the intra-record address catches it, which is
 * what closes D13 (spec §0.2).
 *
 * The modules under test are loaded with a dynamic `import` inside each test: a
 * top-level static import of a file that does not exist yet fails at COLLECTION,
 * which reports `Tests  no tests` and trips the ADR-005 §10.2.1 liveness check.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Ids assembled from parts on purpose: FR-024 assertion 1 treats every bare
 * `ADR-NNN` under `src/` as a citation that MUST resolve, and these fixtures
 * name records that deliberately do not exist. Interpolating keeps
 * `gwrk define adr --check` from reading this suite's own fixtures as real
 * citations — the check would otherwise fail on its own test file.
 */
const adr = (n: string) => `ADR-${n}`;
/** Cited but never present in the fixture corpus. */
const ORPHAN = adr("099");
const ARCHIVED = adr("098");
const LINKED_ORPHAN = adr("097");
/** Illustrative prose only — TC-010's "roughly ADR-0NN" and FR-020's error text. */
const PROSE_ONLY = adr("030");
const ERROR_TEXT_ONLY = adr("042");
/** A template path, not an address (AMBER-1 rule 3). */
const TEMPLATE_PATH = `docs/decisions/${adr("010")}-<slug>.md`;

const loadCheck = () => import("./adr-check.js");
const loadParser = () => import("./adr-parser.js");
const loadIndex = () => import("./adr-index.js");

let root: string;

function write(rel: string, body: string): void {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body);
}

/** ADR-007 with an `## Amendments` registry that does or does not carry 028. */
function adr007(registered: string[]): string {
  const rows = registered.map((id) => `| ${id} | 2.1 | Gate authority is one-way. |`);
  return [
    "# ADR-007: Single Dispatch Path",
    "",
    "> **Status:** Decided · **Date:** 2026-05-22",
    "> **Decision:** All workflow dispatch flows through `WorkflowRuntime`.",
    "> **Constraint:** Code MUST NOT spawn an agent CLI directly.",
    "> **Author:** David Gonzalez · **Decision Scope:** gwrk dispatch architecture",
    "",
    "## 1. Context",
    "",
    "Body.",
    "",
    "## 2. Decision",
    "",
    "### 2.1 Single Dispatch Path",
    "",
    "The agent's verdict is advisory. Gates are truth.",
    "",
    "## Amendments",
    "",
    "| Amending | At | Summary |",
    "|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

const ADR_001 = [
  "# ADR-001: Task Tracking",
  "",
  "> **Status:** Decided · **Date:** 2026-02-26",
  "> **Decision:** Option B (Roll Our Own)",
  "> **Constraint:** Every task MUST be closed by a gate.",
  "> **Author:** David Gonzalez · **Decision Scope:** gwrk core architecture",
  "",
  "## 1. Context",
  "",
  "Body.",
  "",
].join("\n");

/**
 * The pre-fix tree: `ship-orchestrator.ts:492` cites a `028 correction` that
 * ADR-007 does not carry, plus the ignore-list and citation-shape cases the
 * AMBER-1 rule settles (OQ-003).
 */
function seedTree(registeredAmendments: string[]): void {
  write("docs/decisions/ADR-001-task-tracking.md", ADR_001);
  write("docs/decisions/ADR-007-single-dispatch-path.md", adr007(registeredAmendments));

  // Assertion 2's headline: a phantom intra-record address. Line 3 exactly.
  write(
    "src/engine/ship-orchestrator.ts",
    [
      "// 4. Determine verdict from gates (not agent edits).",
      "//    Gate authority is one-way (ADR-007 + 028 correction): a green gate",
      "//    closes a task the reviewer raised no finding against.",
      "",
    ].join("\n"),
  );

  // Assertion 1: a bare id in src/ that resolves to no file.
  write("src/engine/orphan-citation.ts", `// See ${ORPHAN} for the rationale.\n`);

  // AMBER-1 rule 2: a bare prose mention in docs/ makes no address claim.
  write(
    "docs/research/R012-adr-first-class/draft.md",
    `The one-sentence cap defers the ceiling to roughly ${PROSE_ONLY}.\n`,
  );

  // AMBER-1 rule 3: an angle-bracket path is a template, not an address.
  write(
    "specs/029-decision-records/spec.md",
    [
      `Produces \`${TEMPLATE_PATH}\` at the correct number.`,
      `Error text: \`${ERROR_TEXT_ONLY} not found in docs/decisions/\`.`,
      "",
    ].join("\n"),
  );

  // SCAN_IGNORE: stale copies under ignored roots must not be reported.
  write(
    "docs/archive/old-plan.md",
    `Anchored to [${ORPHAN}](../decisions/${ORPHAN}-gone.md).\n`,
  );
  write(
    ".claude/worktrees/stale/notes.md",
    `Anchored to [${ARCHIVED}](../../../docs/decisions/${ARCHIVED}-gone.md).\n`,
  );
}

async function records() {
  const { parseCorpus } = await loadParser();
  return parseCorpus(path.join(root, "docs", "decisions"));
}

/** Bring the index in line with the corpus so assertion 3 is satisfied. */
async function freshIndex(): Promise<void> {
  const { writeIndex } = await loadIndex();
  await writeIndex(root, await records());
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "gwrk-adr-check-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("029 FR-024: a citation that resolves to nothing fails CI (US-010)", () => {
  it.skip("FR-024: reports an unregistered NNN correction citation", async () => {
    const { checkCitations } = await loadCheck();

    seedTree([]); // ADR-007 carries no 028 amendment
    await freshIndex();

    const findings = await checkCitations(root, await records());
    const assertion2 = findings.filter((f) => f.assertion === 2);

    // The defect this feature exists to close. A resolver keyed on ADR-\d+
    // passes it, because ADR-007 resolves.
    expect(assertion2).toHaveLength(1);
    expect(assertion2[0].message).toContain(
      "cites a '028 correction' not registered in ADR-007's ## Amendments",
    );
  });

  it.skip("FR-024: names the citing file and line", async () => {
    const { checkCitations } = await loadCheck();

    seedTree([]);
    await freshIndex();

    const findings = await checkCitations(root, await records());
    const finding = findings.find((f) => f.assertion === 2);

    // Error-as-navigation: repo-relative path, 1-indexed line.
    expect(finding?.file).toBe(path.join("src", "engine", "ship-orchestrator.ts"));
    expect(finding?.line).toBe(2);
  });

  it.skip("FR-024: passes once the amendment is registered", async () => {
    const { checkCitations } = await loadCheck();

    seedTree(["026", "028"]); // FR-006 applied the block, FR-022 registered it
    await freshIndex();

    const findings = await checkCitations(root, await records());

    expect(findings.filter((f) => f.assertion === 2)).toEqual([]);
  });

  it.skip("FR-024: reports an ADR citation with no file in docs/decisions", async () => {
    const { checkCitations } = await loadCheck();

    seedTree(["026", "028"]);
    await freshIndex();

    const findings = await checkCitations(root, await records());
    const assertion1 = findings.filter((f) => f.assertion === 1);

    expect(assertion1).toHaveLength(1);
    expect(assertion1[0].file).toBe(
      path.join("src", "engine", "orphan-citation.ts"),
    );
    expect(assertion1[0].message).toContain(
      `${ORPHAN} does not resolve to a file in docs/decisions/`,
    );
  });

  it.skip("FR-024: reports a stale index hash", async () => {
    const { checkCitations } = await loadCheck();

    seedTree(["026", "028"]);
    await freshIndex();
    // The corpus moves; the index does not.
    write(
      "docs/decisions/ADR-001-task-tracking.md",
      ADR_001.replace("Every task MUST be closed by a gate.", "Anything goes."),
    );

    const findings = await checkCitations(root, await records());
    const assertion3 = findings.filter((f) => f.assertion === 3);

    expect(assertion3).toHaveLength(1);
    expect(assertion3[0].message).toMatch(
      /Decision index is stale\. Run: gwrk define adr --reindex/,
    );
  });

  it.skip("FR-025: the repaired tree produces no findings at all", async () => {
    const { checkCitations } = await loadCheck();

    seedTree(["026", "028"]);
    // FR-025: the citing comment now names the registered amendment address.
    write(
      "src/engine/orphan-citation.ts",
      "// See ADR-007 §2.1 for the rationale.\n",
    );
    await freshIndex();

    // SC-007: exits 0 after FR-006, FR-022 and FR-025 land.
    await expect(checkCitations(root, await records())).resolves.toEqual([]);
  });
});

describe("029 FR-024: the AMBER-1 citation-shape rule (settles OQ-003)", () => {
  it.skip("FR-024: does not report a bare prose mention outside src", async () => {
    const { checkCitations } = await loadCheck();

    seedTree(["026", "028"]);
    write("src/engine/orphan-citation.ts", "// See ADR-007 §2.1.\n");
    await freshIndex();

    const findings = await checkCitations(root, await records());

    // A bare prose mention makes no address claim and is not checked; a
    // literal reading could never exit 0 on this tree.
    expect(findings.map((f) => f.message).join(" ")).not.toContain(PROSE_ONLY);
  });

  it.skip("FR-024: skips an angle-bracket template path", async () => {
    const { checkCitations } = await loadCheck();

    seedTree(["026", "028"]);
    write("src/engine/orphan-citation.ts", "// See ADR-007 §2.1.\n");
    await freshIndex();

    const findings = await checkCitations(root, await records());

    expect(findings.map((f) => f.message).join(" ")).not.toContain(adr("010"));
    expect(findings.map((f) => f.message).join(" ")).not.toContain(ERROR_TEXT_ONLY);
  });

  it.skip("FR-024: ignores docs/archive and .claude", async () => {
    const { checkCitations, SCAN_IGNORE } = await loadCheck();

    seedTree(["026", "028"]);
    write("src/engine/orphan-citation.ts", "// See ADR-007 §2.1.\n");
    await freshIndex();

    const findings = await checkCitations(root, await records());

    expect(SCAN_IGNORE).toContain("docs/archive");
    expect(SCAN_IGNORE).toContain(".claude");
    expect(SCAN_IGNORE).toContain("node_modules");
    expect(SCAN_IGNORE).toContain("dist");
    const files = findings.map((f) => f.file);
    expect(files.some((f) => f.includes("archive"))).toBe(false);
    expect(files.some((f) => f.includes(".claude"))).toBe(false);
  });

  it.skip("FR-024: checks an addressed link citation in docs and specs", async () => {
    const { checkCitations } = await loadCheck();

    seedTree(["026", "028"]);
    write("src/engine/orphan-citation.ts", "// See ADR-007 §2.1.\n");
    // Link-shaped: a real address claim, and it resolves to nothing.
    write(
      "docs/grounding/architecture.md",
      `Anchored to [${LINKED_ORPHAN}](../decisions/${LINKED_ORPHAN}-gone.md).\n`,
    );
    await freshIndex();

    const findings = await checkCitations(root, await records());

    const unresolved = findings.filter((f) => f.assertion === 1);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].file).toBe(
      path.join("docs", "grounding", "architecture.md"),
    );
  });

  it.skip("FR-024: scanSurface reports every citation with a 1-indexed line", async () => {
    const { scanSurface } = await loadCheck();

    seedTree(["026", "028"]);

    const citations = await scanSurface(root);

    expect(citations.length).toBeGreaterThan(0);
    expect(citations.every((c) => c.line >= 1)).toBe(true);
    expect(
      citations.some((c) => c.file === path.join("src", "engine", "orphan-citation.ts")),
    ).toBe(true);
  });
});
