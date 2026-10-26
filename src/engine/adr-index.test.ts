/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * 029 Decision Records — RED tests for TR-005 (FR-009, FR-010, FR-011, FR-012, FR-014).
 *
 * @phase 05
 * @status active
 *
 * Fixture-driven: a nine-record corpus including two `Proposed`, built as
 * contract-shaped `AdrRecord` values rather than read from the live corpus, so
 * ADR-010 landing in phase 09 cannot break this suite. `writeIndex` and
 * `checkIndex` touch a real temp directory — hermetic, no shared state.
 *
 * The module under test is loaded with a dynamic `import` inside each test: a
 * top-level static import of a file that does not exist yet fails at COLLECTION,
 * which reports `Tests  no tests` and trips the ADR-005 §10.2.1 liveness check.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const load = () => import("./adr-index.js");

interface Supersession {
  targetId: string | null;
  qualifier: string;
  raw: string;
}

/** Contract-shaped AdrRecord; `headings`/`amendments` are irrelevant to indexing. */
function makeRecord(opts: {
  number: string;
  title: string;
  status: string;
  date: string;
  decision: string;
  constraint?: string | null;
  scope?: string | null;
  supersedes?: Supersession[];
  body?: string;
  // biome-ignore lint/suspicious/noExplicitAny: fixture factory for a not-yet-shipped type
}): any {
  const id = `ADR-${opts.number}`;
  return {
    number: opts.number,
    id,
    title: opts.title,
    filePath: `/repo/docs/decisions/${id}-${opts.title.toLowerCase().replace(/\W+/g, "-")}.md`,
    header: {
      status: opts.status,
      date: opts.date,
      decision: opts.decision,
      constraint: opts.constraint === undefined ? `Code MUST honour ${id}.` : opts.constraint,
      scope: opts.scope === undefined ? "gwrk core architecture" : opts.scope,
      author: "David Gonzalez",
      dependsOn: [],
      supersedes: opts.supersedes ?? [],
    },
    headings: [],
    amendments: [],
    raw: `# ${id}: ${opts.title}\n\n${opts.body ?? "Body."}\n`,
  };
}

/** Nine records, two of them `Proposed` — ADR-006 and ADR-007. */
// biome-ignore lint/suspicious/noExplicitAny: fixture factory for a not-yet-shipped type
function nineRecords(): any[] {
  return [
    makeRecord({
      number: "001",
      title: "Task Tracking",
      status: "Decided",
      date: "2026-02-26",
      decision: "Option B (Roll Our Own — Flat JSON/JSONL)",
      constraint: "Every task MUST be closed by a gate, never by narrative.",
    }),
    makeRecord({
      number: "002",
      title: "SQLite Execution Ledger",
      status: "Decided",
      date: "2026-03-05",
      decision: "SQLite via better-sqlite3",
      supersedes: [
        {
          targetId: "ADR-001",
          qualifier: "(storage mechanism only)",
          raw: "[ADR-001](./ADR-001-task-tracking.md) (storage mechanism only)",
        },
      ],
    }),
    makeRecord({
      number: "003",
      title: "State Contract",
      status: "Decided",
      date: "2026-03-08",
      decision: "Git-native execution manifests",
      supersedes: [
        {
          targetId: "ADR-002",
          qualifier: "Partial aspects of ADR-002 §3 (Learning Loop Extraction)",
          raw: "Partial aspects of ADR-002 §3 (Learning Loop Extraction)",
        },
      ],
    }),
    makeRecord({
      number: "004",
      title: "Agent Native Output",
      status: "Decided",
      date: "2026-03-12",
      decision: "Every command emits [exit:N | Xs]",
    }),
    makeRecord({
      number: "005",
      title: "TDD Gate Architecture",
      status: "Decided",
      date: "2026-03-16",
      decision: "LLM-authored gates from contracts",
    }),
    makeRecord({
      number: "006",
      title: "Plugin Agent Backends",
      status: "Proposed",
      date: "2026-05-10",
      decision: "Agent backends ship as plugins",
    }),
    makeRecord({
      number: "007",
      title: "Single Dispatch Path",
      status: "Proposed",
      date: "2026-05-22",
      decision: "All workflow dispatch flows through WorkflowRuntime",
      constraint:
        "Code MUST NOT spawn an agent CLI directly; dispatch MUST go through WorkflowRuntime.",
      scope: "gwrk dispatch architecture",
    }),
    makeRecord({
      number: "008",
      title: "Command Safety Posture",
      status: "Decided",
      date: "2026-06-02",
      decision: "Layered command safety",
    }),
    makeRecord({
      number: "009",
      title: "Domain Ontology Grounding",
      status: "Decided",
      date: "2026-06-20",
      decision: "Project knowledge reaches every dispatch",
    }),
  ];
}

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "gwrk-adr-index-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("029 FR-011: the index hides nothing (US-005)", () => {
  it("FR-011: emits one row per record and never filters on status", async () => {
    const { buildIndex } = await load();

    const index = buildIndex(nineRecords());

    expect(index.rows).toHaveLength(9);
    // A `Status: Decided` filter would drop ADR-006 and ADR-007 — the two
    // records defining the dispatch path any injection rides on (SC-006).
    const ids = index.rows.map((r) => r.id);
    expect(ids).toContain("ADR-006");
    expect(ids).toContain("ADR-007");
    expect(ids).toEqual([...ids].sort());
  });

  it("FR-011: emits the ADR Scope Status Constraint header", async () => {
    const { buildIndex, renderIndex } = await load();

    const rendered = renderIndex(buildIndex(nineRecords()));

    expect(rendered).toContain("| ADR | Scope | Status | Constraint |");
    expect(rendered).toMatch(/^\| ADR-001 \|/m);
    expect(rendered.match(/^\| ADR-0\d\d \|/gm)).toHaveLength(9);
  });

  it("FR-011: stays inside the 1000-token injection budget", async () => {
    const { buildIndex, renderIndex } = await load();

    const rendered = renderIndex(buildIndex(nineRecords()));
    // VR-008: measured, not estimated. ~4 characters per token is the working
    // approximation; TC-010 puts nine rows near 380 tokens and sets 1,000 as
    // the revisit threshold.
    const tokens = Math.ceil(rendered.length / 4);

    expect(tokens).toBeLessThan(1000);
  });

  it("FR-011: keeps a Proposed record's status legible rather than blank", async () => {
    const { buildIndex } = await load();

    const index = buildIndex(nineRecords());
    const row = index.rows.find((r) => r.id === "ADR-007");

    expect(row?.status).toContain("Proposed");
  });
});

describe("029 FR-010: the Constraint column (US-005)", () => {
  it("FR-010: projects the Constraint field into the row", async () => {
    const { buildIndex } = await load();

    const index = buildIndex(nineRecords());
    const row = index.rows.find((r) => r.id === "ADR-007");

    // SC-005: ADR-007's `Decision:` line alone does not tell an implementer
    // that a spawn("claude") is forbidden. The Constraint does.
    expect(row?.constraint).toBe(
      "Code MUST NOT spawn an agent CLI directly; dispatch MUST go through WorkflowRuntime.",
    );
    expect(row?.constraint).toMatch(/MUST NOT/);
  });

  it("FR-010: renders an empty Constraint cell rather than omitting the row", async () => {
    const { buildIndex, renderIndex } = await load();

    const records = nineRecords();
    records[3].header.constraint = null; // an unmigrated record

    const index = buildIndex(records);
    const row = index.rows.find((r) => r.id === "ADR-004");

    expect(index.rows).toHaveLength(9);
    expect(row).toBeDefined();
    expect(row?.constraint).toBe("");
    expect(renderIndex(index)).toMatch(/^\| ADR-004 \|/m);
  });

  it("FR-010: projects the Decision Scope into the Scope column", async () => {
    const { buildIndex } = await load();

    const index = buildIndex(nineRecords());

    expect(index.rows.find((r) => r.id === "ADR-007")?.scope).toBe(
      "gwrk dispatch architecture",
    );
  });
});

describe("029 FR-012: a partial supersession does not read as a retirement (US-006)", () => {
  it("FR-012: derives the back-reference onto the superseded row", async () => {
    const { buildIndex } = await load();

    const index = buildIndex(nineRecords());
    const row001 = index.rows.find((r) => r.id === "ADR-001");

    // Derived from ADR-002's forward `Supersedes` field alone — no corpus edit
    // records a back-reference.
    expect(row001?.status).toContain("ADR-002");
    expect(row001?.status).toMatch(/superseded in part by ADR-002/);
    // The record's own status survives alongside the derived edge.
    expect(row001?.status).toContain("Decided");
  });

  it("FR-012: carries the qualifier verbatim", async () => {
    const { buildIndex } = await load();

    const index = buildIndex(nineRecords());

    expect(index.rows.find((r) => r.id === "ADR-001")?.status).toContain(
      "(storage mechanism only)",
    );
  });

  it("FR-012: preserves a free-text partial supersession", async () => {
    const { buildIndex } = await load();

    const index = buildIndex(nineRecords());
    const row002 = index.rows.find((r) => r.id === "ADR-002");

    expect(row002?.status).toContain("ADR-003");
    expect(row002?.status).toContain("Learning Loop Extraction");
  });

  it("FR-012: never flattens a qualified supersession to a bare boolean", async () => {
    const { buildIndex } = await load();

    const index = buildIndex(nineRecords());
    const row001 = index.rows.find((r) => r.id === "ADR-001");

    // A bare "superseded" would tell an agent to ignore ADR-001, whose Hard
    // Gate Architecture is live and cited from ADR-005's own header.
    expect(row001?.status).not.toBe("Superseded");
    expect(row001?.status).toMatch(/in part/);
  });

  it("FR-012: leaves an unsuperseded row's status untouched", async () => {
    const { buildIndex } = await load();

    const index = buildIndex(nineRecords());

    expect(index.rows.find((r) => r.id === "ADR-009")?.status).toBe("Decided");
  });
});

describe("029 FR-009 / FR-014: index staleness is detectable, not assumed (US-008)", () => {
  it("FR-009: produces a stable hash for identical input", async () => {
    const { hashCorpus } = await load();

    const a = hashCorpus(nineRecords());
    const b = hashCorpus(nineRecords());

    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8,}$/);
  });

  it("FR-009: hashes the parsed headers, not raw bytes (DM-002)", async () => {
    const { hashCorpus } = await load();

    const baseline = hashCorpus(nineRecords());
    const proseEdited = nineRecords();
    proseEdited[4].raw = `${proseEdited[4].raw}\n\nA new paragraph below the header.\n`;

    // A prose edit below the header must not report the index stale.
    expect(hashCorpus(proseEdited)).toBe(baseline);
  });

  it("FR-009: diverges when a header field changes", async () => {
    const { hashCorpus } = await load();

    const baseline = hashCorpus(nineRecords());
    const mutated = nineRecords();
    mutated[6].header.constraint = "Code MAY do whatever it likes.";

    expect(hashCorpus(mutated)).not.toBe(baseline);
  });

  it("FR-014: exits 0 when the hash matches the corpus", async () => {
    const { writeIndex, checkIndex } = await load();

    const records = nineRecords();
    const written = await writeIndex(tmp, records);
    const result = await checkIndex(tmp, records);

    expect(written).toBe(path.join(tmp, ".gwrk", "decisions", "index.md"));
    expect(readFileSync(written, "utf-8")).toContain(
      "| ADR | Scope | Status | Constraint |",
    );
    expect(result.ok).toBe(true);
    expect(result.divergent).toEqual([]);
    expect(result.message).toBeNull();
  });

  it("FR-014: exits non-zero when the hash disagrees", async () => {
    const { writeIndex, checkIndex } = await load();

    await writeIndex(tmp, nineRecords());
    const mutated = nineRecords();
    mutated[6].header.constraint = "Code MAY spawn an agent CLI directly.";

    const result = await checkIndex(tmp, mutated);

    expect(result.ok).toBe(false);
    expect(result.divergent).toContain("ADR-007");
    expect(result.message).toMatch(
      /Decision index is stale\. Run: gwrk define adr --reindex/,
    );
  });

  it("FR-014: reports an absent index with the corrective command", async () => {
    const { checkIndex } = await load();

    const result = await checkIndex(tmp, nineRecords());

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(
      /No decision index at \.gwrk\/decisions\/index\.md\. Run: gwrk define adr --reindex/,
    );
  });

  it("FR-014: reports a record added to the corpus but not to the index", async () => {
    const { writeIndex, checkIndex } = await load();

    await writeIndex(tmp, nineRecords());
    const withTenth = [
      ...nineRecords(),
      makeRecord({
        number: "010",
        title: "Decision Records",
        status: "Proposed",
        date: "2026-08-20",
        decision: "ADRs become a first-class gwrk artifact",
      }),
    ];

    const result = await checkIndex(tmp, withTenth);

    expect(result.ok).toBe(false);
    expect(result.divergent).toContain("ADR-010");
  });

  it("FR-009: writes the index under .gwrk, never into the human-authored corpus", async () => {
    const { writeIndex } = await load();

    // TC-004: source-scanner readdirs docs/decisions and would push an index
    // living there into the ontology prompt, doubling the corpus.
    mkdirSync(path.join(tmp, "docs", "decisions"), { recursive: true });
    writeFileSync(path.join(tmp, "docs", "decisions", "ADR-001-x.md"), "# ADR-001: X\n");

    const written = await writeIndex(tmp, nineRecords());

    expect(written).toContain(path.join(".gwrk", "decisions"));
    expect(written).not.toContain(path.join("docs", "decisions"));
  });

  it("FR-009: creates .gwrk/decisions when it is absent", async () => {
    const { writeIndex } = await load();

    const written = await writeIndex(tmp, nineRecords());

    expect(readFileSync(written, "utf-8").length).toBeGreaterThan(0);
  });
});
