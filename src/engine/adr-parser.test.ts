/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * 029 Decision Records — RED tests for TR-002 (FR-004, FR-005).
 *
 * @phase 01
 * @status red
 *
 * Every `it.skip` here is un-skipped by ship's ACTIVATE_TESTS stage
 * (`src/engine/test-activator.ts`) when phase-01 starts, which is also where
 * RED is established. The module under test is loaded with a dynamic `import`
 * inside each test on purpose: a top-level static import of a file that does
 * not exist yet fails at COLLECTION, which reports `Tests  no tests` and trips
 * the ADR-005 §10.2.1 liveness check ("a test that never ran cannot be RED").
 *
 * Fixtures are the only input. A corpus-coupled suite breaks when ADR-010 lands
 * in phase 09, and `retry: 1` in vitest.config.ts would surface that as flake.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Ids assembled from parts on purpose: FR-024 assertion 1 treats every bare
 * `ADR-NNN` under `src/` as a citation that MUST resolve, and these fixtures
 * name records that deliberately do not exist. Interpolating keeps
 * `gwrk define adr --check` from reading a fixture as a real citation.
 */
const adr = (n: string) => `ADR-${n}`;

const load = () => import("./adr-parser.js");

/**
 * ADR-001's real shape: `# ADR: <title>` with the number only in the filename,
 * trailing double-space hard breaks, `·` separating two fields on one line, no
 * `Supersedes`, no `Depends on`, and two `## 7.` headings.
 */
const ADR_001 = [
  "# ADR: Task Tracking — Beads (bd + Dolt) vs. Roll Our Own",
  "",
  "> **Status:** Decided · **Date:** 2026-02-26  ",
  "> **Decision:** Option B (Roll Our Own — Flat JSON/JSONL)  ",
  "> **Author:** David Gonzalez · **Decision Scope:** gwrk core architecture",
  "",
  "---",
  "",
  "## 1. Context",
  "",
  "gwrk needs a task tracking system for decomposed feature work.",
  "",
  "## 7. Decision: Option B (Roll Our Own — Flat JSON/JSONL)",
  "",
  "Flat files win.",
  "",
  "## 7. Next Steps",
  "",
  "Ship the tracker.",
  "",
].join("\n");

/** ADR-002's real shape: `# ADR: <title>`, a parenthetically qualified `Supersedes`. */
const ADR_002 = [
  "# ADR: Task Storage & Execution Ledger — Flat JSON → SQLite",
  "",
  "> **Status:** Decided · **Date:** 2026-03-05",
  "> **Decision:** SQLite via `better-sqlite3` (global `~/.gwrk/gwrk.db`)",
  "> **Supersedes:** [ADR-001](./ADR-001-task-tracking.md) (storage mechanism only)",
  "> **Author:** David Gonzalez · **Decision Scope:** gwrk core architecture",
  "",
  "---",
  "",
  "## 1. Context",
  "",
  "Body.",
  "",
].join("\n");

/** ADR-003's real shape: numbered H1, free-text supersession, `Depends on` absent. */
const ADR_003 = [
  "# ADR-003: Execution State Contract — Git-Native Manifests",
  "",
  "> **Status:** Decided · **Date:** 2026-03-08",
  "> **Decision:** Git-native execution manifests + build-server-side SQLite harvest",
  "> **Supersedes:** Partial aspects of ADR-002 §3 (Learning Loop Extraction)",
  "> **Author:** David Gonzalez · **Decision Scope:** gwrk state architecture",
  "",
  "---",
  "",
  "## 1. Context",
  "",
  "Body.",
  "",
].join("\n");

/** ADR-007's real shape: `Depends on` present, nested `### N.M` assertion headings. */
const ADR_007 = [
  "# ADR-007: Single Dispatch Path & `.agents/` Deprecation",
  "",
  "> **Status:** Decided · **Date:** 2026-05-22",
  "> **Decision:** All workflow dispatch flows through `WorkflowRuntime`.",
  "> **Constraint:** Code MUST NOT spawn an agent CLI directly; dispatch MUST go through `WorkflowRuntime`.",
  "> **Depends on:** ADR-006 (Plugin Agent Backends), F014 (Plugin System)",
  "> **Author:** David Gonzalez · **Decision Scope:** gwrk dispatch architecture",
  "",
  "---",
  "",
  "## 1. Context",
  "",
  "Two independent dispatch paths emerged.",
  "",
  "### Forces",
  "",
  "Force text.",
  "",
  "## 2. Decision",
  "",
  "### 2.1 Single Dispatch Path",
  "",
  "The agent's verdict is advisory. Gates are truth.",
  "",
  "### 2.2 `.agents/` Deprecation & Removal",
  "",
  "Removal text.",
  "",
  "## 3. Impact Analysis",
  "",
  "Impact text.",
  "",
  "## Amendments",
  "",
  "| Amending | At | Summary |",
  "|---|---|---|",
  "| 026 | 2.1 | Gate authority is one-way. |",
  "",
].join("\n");

describe("029 FR-004: the nine existing records parse unchanged (US-002)", () => {
  it.skip("FR-004: recovers the number from the filename when the H1 omits it", async () => {
    const { parseRecord } = await load();

    const record = parseRecord(ADR_001, "ADR-001-task-tracking.md");

    expect(record.number).toBe("001");
    expect(record.id).toBe("ADR-001");
    expect(record.title).toBe("Task Tracking — Beads (bd + Dolt) vs. Roll Our Own");
    // The numbered form must keep working: the number comes from the H1 and
    // filename agreement is not required (contract §2).
    expect(parseRecord(ADR_003, "ADR-003-state-contract.md").number).toBe("003");
  });

  it.skip("FR-004: tolerates trailing double-space hard breaks", async () => {
    const { parseRecord } = await load();

    const record = parseRecord(ADR_001, "ADR-001-task-tracking.md");

    expect(record.header.date).toBe("2026-02-26");
    expect(record.header.decision).toBe("Option B (Roll Our Own — Flat JSON/JSONL)");
    // The hard break must be stripped, not carried into the value.
    expect(record.header.decision).not.toMatch(/\s$/);
    expect(record.header.date).not.toMatch(/\s$/);
  });

  it.skip("FR-004: returns empty relations rather than throwing", async () => {
    const { parseRecord } = await load();

    // ADR-001 carries neither `Supersedes` nor `Depends on`.
    const record = parseRecord(ADR_001, "ADR-001-task-tracking.md");

    expect(record.header.dependsOn).toEqual([]);
    expect(record.header.supersedes).toEqual([]);
    // An absent optional field is never an error (contract §2).
    expect(record.header.constraint).toBeNull();
  });

  it.skip("FR-004: splits two fields separated by the middle dot", async () => {
    const { parseRecord } = await load();

    const record = parseRecord(ADR_001, "ADR-001-task-tracking.md");

    // `> **Status:** Decided · **Date:** 2026-02-26`
    expect(record.header.status).toBe("Decided");
    expect(record.header.date).toBe("2026-02-26");
    // `> **Author:** David Gonzalez · **Decision Scope:** gwrk core architecture`
    expect(record.header.author).toBe("David Gonzalez");
    expect(record.header.scope).toBe("gwrk core architecture");
  });

  it.skip("FR-004: preserves a 240-character Decision value", async () => {
    const { parseRecord } = await load();

    const long = `Option ${"x".repeat(233)}`;
    expect(long).toHaveLength(240);
    const fixture = [
      "# ADR-004: Long Decision",
      "",
      "> **Status:** Decided · **Date:** 2026-03-20",
      `> **Decision:** ${long}`,
      "> **Author:** David Gonzalez · **Decision Scope:** gwrk core architecture",
      "",
      "## 1. Context",
      "",
      "Body.",
      "",
    ].join("\n");

    const record = parseRecord(fixture, "ADR-004-long-decision.md");

    // Truncation is the index's concern, not the parser's (contract §2).
    expect(record.header.decision).toBe(long);
    expect(record.header.decision).toHaveLength(240);
  });

  it.skip("FR-004: parses a parenthetically qualified Supersedes with the qualifier verbatim", async () => {
    const { parseRecord } = await load();

    const record = parseRecord(ADR_002, "ADR-002-sqlite-execution-ledger.md");

    expect(record.header.supersedes).toHaveLength(1);
    expect(record.header.supersedes[0].targetId).toBe("ADR-001");
    expect(record.header.supersedes[0].qualifier).toBe("(storage mechanism only)");
    expect(record.header.supersedes[0].raw).toContain("storage mechanism only");
  });

  it.skip("FR-004: parses a free-text Supersedes without inventing a target", async () => {
    const { parseRecord } = await load();

    const record = parseRecord(ADR_003, "ADR-003-state-contract.md");

    expect(record.header.supersedes).toHaveLength(1);
    // The qualifier survives as written; a free-text form must not be dropped.
    expect(record.header.supersedes[0].raw).toBe(
      "Partial aspects of ADR-002 §3 (Learning Loop Extraction)",
    );
    expect(record.header.supersedes[0].qualifier).toContain("Learning Loop Extraction");
  });

  it.skip("FR-004: parses Depends on into a list", async () => {
    const { parseRecord } = await load();

    const record = parseRecord(ADR_007, "ADR-007-single-dispatch-path.md");

    expect(record.header.dependsOn.length).toBeGreaterThan(0);
    expect(record.header.dependsOn.join(" ")).toContain("ADR-006");
  });

  it.skip("FR-004: throws when no blockquote header follows the H1", async () => {
    const { parseRecord } = await load();

    const headerless = `# ${adr("042")}: Headerless\n\n## 1. Context\n\nBody.\n`;

    // FR-014 error state: `<path>: no blockquote header found after the H1`.
    expect(() => parseRecord(headerless, `${adr("042")}-headerless.md`)).toThrow(
      /no blockquote header found after the H1/,
    );
  });

  it.skip("FR-004: parses the Constraint field when present and leaves it null when absent", async () => {
    const { parseRecord } = await load();

    const withField = parseRecord(ADR_007, "ADR-007-single-dispatch-path.md");
    const without = parseRecord(ADR_001, "ADR-001-task-tracking.md");

    expect(withField.header.constraint).toBe(
      "Code MUST NOT spawn an agent CLI directly; dispatch MUST go through `WorkflowRuntime`.",
    );
    expect(without.header.constraint).toBeNull();
  });

  it.skip("FR-004: parses the ## Amendments registry into amendments", async () => {
    const { parseRecord } = await load();

    const record = parseRecord(ADR_007, "ADR-007-single-dispatch-path.md");

    // The registry `--check` assertion 2 reads (FR-022, FR-024). ADR-001 has
    // none, and an absent registry is an empty list rather than a throw.
    expect(record.amendments.map((a) => a.amendingId)).toEqual(["026"]);
    expect(record.amendments[0].at).toBe("2.1");
    expect(record.amendments[0].summary).toContain("one-way");
    expect(parseRecord(ADR_001, "ADR-001-task-tracking.md").amendments).toEqual([]);
  });

  it.skip("FR-004: uses fixtures, never the live corpus", async () => {
    // Self-assertion (TR-002): this suite must not read the checked-in corpus.
    // The needle is assembled from parts so this assertion cannot match itself.
    const corpusDir = ["docs", "decisions"].join("/");
    const ownSource = readFileSync(fileURLToPath(import.meta.url), "utf-8");

    const cwdCall = `${"process."}${"cwd()"}`;

    expect(ownSource).not.toContain(corpusDir);
    expect(ownSource).not.toContain(cwdCall);
  });
});

describe("029 FR-005: heading-tree extraction and section addressing (US-002, US-009)", () => {
  it.skip("FR-005: extracts the heading tree with dotted addresses and depths", async () => {
    const { parseRecord } = await load();

    const record = parseRecord(ADR_007, "ADR-007-single-dispatch-path.md");
    const flat: Array<{ address: string | null; depth: number; title: string }> = [];
    const walk = (nodes: typeof record.headings) => {
      for (const node of nodes) {
        flat.push({ address: node.address, depth: node.depth, title: node.title });
        walk(node.children);
      }
    };
    walk(record.headings);

    const addresses = flat.map((h) => h.address);
    expect(addresses).toContain("1");
    expect(addresses).toContain("2");
    expect(addresses).toContain("2.1");
    expect(addresses).toContain("2.2");
    expect(addresses).toContain("3");
    // `## Amendments` is unnumbered: its address is null, not invented.
    const registry = flat.find((h) => h.title.trim() === "Amendments");
    expect(registry).toBeDefined();
    expect(registry?.address).toBeNull();
    // `### 2.1` is nested under `## 2`, not a sibling.
    expect(flat.find((h) => h.address === "2")?.depth).toBe(2);
    expect(flat.find((h) => h.address === "2.1")?.depth).toBe(3);
  });

  it.skip("FR-005: records a bodyEnd one past the last line of the section body", async () => {
    const { parseRecord, resolveSection } = await load();

    const record = parseRecord(ADR_007, "ADR-007-single-dispatch-path.md");
    const section = resolveSection(record, "2.1");
    const lines = ADR_007.split("\n");

    expect(section).not.toBeNull();
    // The insertion point `--amend --at` uses: inside §2.1, before `### 2.2`.
    const heading = section as NonNullable<typeof section>;
    expect(heading.bodyEnd).toBeGreaterThan(heading.line);
    expect(lines.slice(heading.line, heading.bodyEnd).join("\n")).toContain(
      "Gates are truth",
    );
    expect(lines.slice(heading.line, heading.bodyEnd).join("\n")).not.toContain(
      "Deprecation & Removal",
    );
  });

  it.skip("FR-005: resolveSection returns null for an unresolvable address", async () => {
    const { parseRecord, resolveSection } = await load();

    const record = parseRecord(ADR_007, "ADR-007-single-dispatch-path.md");

    expect(resolveSection(record, "9.9")).toBeNull();
    expect(resolveSection(record, "4")).toBeNull();
  });

  it.skip("FR-005: resolveSection never falls back to a line number", async () => {
    const { parseRecord, resolveSection } = await load();

    const record = parseRecord(ADR_007, "ADR-007-single-dispatch-path.md");

    // OQ-001: `ADR-007 §78` is a line number dressed as a section address. The
    // correct address is §2.1, and §78 must resolve to nothing.
    expect(resolveSection(record, "78")).toBeNull();
  });

  it.skip("FR-005: listSectionAddresses lists every resolvable address in document order", async () => {
    const { parseRecord, listSectionAddresses } = await load();

    const record = parseRecord(ADR_007, "ADR-007-single-dispatch-path.md");
    const addresses = listSectionAddresses(record);

    expect(addresses).toEqual(["1", "2", "2.1", "2.2", "3"]);
    // Consumed by the FR-020 error message, so the unnumbered registry stays out.
    expect(addresses).not.toContain("Amendments");
  });

  it.skip("FR-005: keeps both headings of a duplicate-address fixture and still resolves the address", async () => {
    const { parseRecord, resolveSection } = await load();

    // ADR-001 carries two `## 7.` headings pre-reconciliation. The parser must
    // neither throw nor silently drop one — the corpus edit deduplicates them.
    const record = parseRecord(ADR_001, "ADR-001-task-tracking.md");
    const sevens = record.headings.filter((h) => h.address === "7");

    expect(sevens).toHaveLength(2);
    expect(sevens.map((h) => h.title)).toEqual([
      "Decision: Option B (Roll Our Own — Flat JSON/JSONL)",
      "Next Steps",
    ]);
    expect(resolveSection(record, "7")).not.toBeNull();
  });
});

describe("029 FR-004: parseCorpus filters on the suffix and the pattern", () => {
  it.skip("FR-004: reads only ADR-NNN-*.md entries and returns them sorted ascending", async () => {
    const { parseCorpus } = await load();
    const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const nodePath = (await import("node:path")).default;

    const dir = mkdtempSync(nodePath.join(tmpdir(), "gwrk-adr-corpus-"));
    writeFileSync(nodePath.join(dir, "ADR-003-state-contract.md"), ADR_003);
    writeFileSync(nodePath.join(dir, "ADR-001-task-tracking.md"), ADR_001);
    writeFileSync(nodePath.join(dir, "ADR-002-sqlite-execution-ledger.md"), ADR_002);
    // Junk a raw readdir would swallow — the research allocator's first flaw.
    writeFileSync(nodePath.join(dir, "README.md"), "# not a record\n");
    writeFileSync(nodePath.join(dir, "ADR-9-badly-numbered.md"), ADR_003);
    writeFileSync(nodePath.join(dir, "ADR-004-not-markdown.txt"), ADR_003);
    mkdirSync(nodePath.join(dir, "ADR-005-a-directory"));

    const records = await parseCorpus(dir);

    expect(records.map((r) => r.id)).toEqual(["ADR-001", "ADR-002", "ADR-003"]);
    // A directory entry is skipped, not read (contract §2).
    expect(records.map((r) => r.id)).not.toContain("ADR-005");
  });

  it.skip("FR-004: returns an empty list for a directory that does not exist", async () => {
    const { parseCorpus } = await load();
    const nodePath = (await import("node:path")).default;

    await expect(parseCorpus(nodePath.join("/nonexistent-gwrk", "nope"))).resolves.toEqual([]);
  });
});
