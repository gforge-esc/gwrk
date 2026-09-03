/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * 029 Decision Records — RED tests for TR-007 (FR-020, FR-021, FR-022, FR-023, FR-026).
 *
 * @phase 08
 * @status red
 *
 * Records are built by `parseRecord` (phase 01) from an ADR-007-shaped fixture,
 * so section addressing is exercised against a real heading tree rather than a
 * hand-built stub. The engine half of `--decide` lives here per contract §5;
 * the command half (`--decide` dispatches no workflow, regenerates the index)
 * is a phase-08 amendment to `src/commands/adr.test.ts` — see `gap-matrix.md`.
 *
 * The modules under test are loaded with a dynamic `import` inside each test: a
 * top-level static import of a file that does not exist yet fails at COLLECTION,
 * which reports `Tests  no tests` and trips the ADR-005 §10.2.1 liveness check.
 */

import { describe, expect, it } from "vitest";

const loadAmend = () => import("./adr-amend.js");
const loadParser = () => import("./adr-parser.js");

const ADR_007_FIXTURE = [
  "# ADR-007: Single Dispatch Path & `.agents/` Deprecation",
  "",
  "> **Status:** Decided · **Date:** 2026-05-22",
  "> **Decision:** All workflow dispatch flows through `WorkflowRuntime`.",
  "> **Constraint:** Code MUST NOT spawn an agent CLI directly.",
  "> **Depends on:** ADR-006 (Plugin Agent Backends)",
  "> **Author:** David Gonzalez · **Decision Scope:** gwrk dispatch architecture",
  "",
  "---",
  "",
  "## 1. Context",
  "",
  "Two independent dispatch paths emerged.",
  "",
  "## 2. Decision",
  "",
  "### 2.1 Single Dispatch Path",
  "",
  "The agent's verdict is advisory. Gates are truth.",
  "",
  "> **026 correction.** Gate authority is one-way.",
  "",
  "### 2.2 `.agents/` Deprecation",
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

/** ADR-005's shape: appended sections §8–§12 plus the unnumbered registry. */
const ADR_005_FIXTURE = [
  "# ADR-005: TDD Gate Architecture",
  "",
  "> **Status:** Decided · **Date:** 2026-03-16",
  "> **Decision:** LLM-authored gates from contracts",
  "> **Author:** David Gonzalez · **Decision Scope:** gwrk verification",
  "",
  "## 1. Context",
  "",
  "Body.",
  "",
  "## 7. Decision Record",
  "",
  "Body.",
  "",
  "## 8. Amendment: Deterministic Vitest Gates (2026-03-16)",
  "",
  "Body.",
  "",
  "## 12. Amendment (feature 026 — gate runner convergence)",
  "",
  "Body.",
  "",
  "## Amendments",
  "",
  "| Amending | At | Summary |",
  "|---|---|---|",
  "",
].join("\n");

const ADR_010_PROPOSED = [
  "# ADR-010: Decision Records",
  "",
  "> **Status:** Proposed · **Date:** 2026-08-20",
  "> **Decision:** ADRs become a first-class gwrk artifact",
  "> **Constraint:** Every recorded decision MUST reach a dispatch through the index.",
  "> **Author:** David Gonzalez · **Decision Scope:** gwrk definition pipeline",
  "",
  "## 1. Context",
  "",
  "Body.",
  "",
  "## Amendments",
  "",
].join("\n");

async function record(fixture: string, filename: string) {
  const { parseRecord } = await loadParser();
  return parseRecord(fixture, filename);
}

const ADR_007_FILE = "ADR-007-single-dispatch-path.md";

describe("029 FR-020: section-addressed insertion (US-009)", () => {
  it.skip("FR-020: inserts at the end of the addressed section body", async () => {
    const { amendAtSection } = await loadAmend();

    const rec = await record(ADR_007_FIXTURE, ADR_007_FILE);
    const result = amendAtSection(rec, "2.1", {
      amendingId: "029",
      body: "Citations now resolve through the registry.",
    });

    const lines = result.content.split("\n");
    const inserted = lines.findIndex((l) => l.includes("029 correction"));
    const sectionStart = lines.findIndex((l) => l.startsWith("### 2.1 "));
    const nextSection = lines.findIndex((l) => l.startsWith("### 2.2 "));

    expect(inserted).toBeGreaterThan(sectionStart);
    expect(inserted).toBeLessThan(nextSection);
    // The form ADR-007 already uses at :80 — an inline correction blockquote.
    expect(lines[inserted].startsWith(">")).toBe(true);
    expect(result.content).toContain(
      "Citations now resolve through the registry.",
    );
  });

  it.skip("FR-020: resolves the address through the heading tree, not a line number", async () => {
    const { amendAtSection } = await loadAmend();

    const rec = await record(ADR_007_FIXTURE, ADR_007_FILE);

    // OQ-001: `§78` is a line number dressed as a section address. ADR-007's
    // heading tree tops out at `## 3.`, so §78 must be unresolvable even though
    // line 78 exists in the real record.
    expect(() =>
      amendAtSection(rec, "78", { amendingId: "029", body: "x" }),
    ).toThrow(/§78: no such section/);
  });

  it.skip("FR-020: fails on an unresolvable section address", async () => {
    const { amendAtSection } = await loadAmend();

    const rec = await record(ADR_007_FIXTURE, ADR_007_FILE);

    // Error-as-navigation: name the offending address and list what exists.
    expect(() =>
      amendAtSection(rec, "9.9", { amendingId: "029", body: "x" }),
    ).toThrow(/ADR-007 §9\.9: no such section\. Sections: .*2\.1/);
  });

  it.skip("FR-020: emits a full-file WRITE_FILE that grows the file", async () => {
    const { amendAtSection } = await loadAmend();

    const rec = await record(ADR_007_FIXTURE, ADR_007_FILE);
    const result = amendAtSection(rec, "2.1", {
      amendingId: "029",
      body: "Citations now resolve through the registry.",
    });

    // IntentEngine executes only WRITE_FILE / CREATE_DIR / RUN_COMMAND — there
    // is no patch or append verb — and wouldShrinkExistingFile drops a
    // shrinking write, so an amendment must always grow the file.
    expect(result.filePath).toBe(rec.filePath);
    expect(result.content.length).toBeGreaterThan(rec.raw.length);
    expect(result.content.split("\n")[0]).toBe(rec.raw.split("\n")[0]);
    // Full file, not a fragment: everything that was there is still there.
    expect(result.content).toContain("## 1. Context");
    expect(result.content).toContain("## 3. Impact Analysis");
    expect(result.content).toContain("026 correction");
  });

  it.skip("FR-020: leaves every other section byte-identical", async () => {
    const { amendAtSection } = await loadAmend();

    const rec = await record(ADR_007_FIXTURE, ADR_007_FILE);
    const result = amendAtSection(rec, "2.1", {
      amendingId: "029",
      body: "Citations now resolve through the registry.",
    });

    const before = rec.raw.slice(0, rec.raw.indexOf("### 2.1"));
    expect(result.content.startsWith(before)).toBe(true);
  });
});

describe("029 FR-021: --append-section numbering (US-009)", () => {
  it.skip("FR-021: numbers the new section max plus 1 over existing ## N. headings", async () => {
    const { appendSection } = await loadAmend();

    const rec = await record(ADR_005_FIXTURE, "ADR-005-tdd-gate-architecture.md");
    const result = appendSection(rec, {
      amendingId: "029",
      title: "Amendment: Decision Records",
      body: "Body.",
    });

    // Existing `## N.` headings top out at 12, so the next is 13. The
    // unnumbered `## Amendments` registry is excluded from the scan (AMBER-2).
    expect(result.content).toMatch(/^## 13\. Amendment: Decision Records$/m);
    expect(result.content).not.toMatch(/^## 1\. Amendment: Decision Records$/m);
  });

  it.skip("FR-021: inserts the appended section before the ## Amendments registry", async () => {
    const { appendSection } = await loadAmend();

    const rec = await record(ADR_005_FIXTURE, "ADR-005-tdd-gate-architecture.md");
    const result = appendSection(rec, {
      amendingId: "029",
      title: "Amendment: Decision Records",
      body: "Body.",
    });

    const lines = result.content.split("\n");
    const appended = lines.findIndex((l) => l.startsWith("## 13. "));
    const registry = lines.findIndex((l) => l === "## Amendments");

    expect(appended).toBeGreaterThan(-1);
    expect(registry).toBeGreaterThan(appended);
  });

  it.skip("FR-021: grows the file and keeps the registry last", async () => {
    const { appendSection } = await loadAmend();

    const rec = await record(ADR_005_FIXTURE, "ADR-005-tdd-gate-architecture.md");
    const result = appendSection(rec, {
      amendingId: "029",
      title: "Amendment: Decision Records",
      body: "Body.",
    });

    expect(result.content.length).toBeGreaterThan(rec.raw.length);
    const afterRegistry = result.content.slice(
      result.content.indexOf("\n## Amendments"),
    );
    expect(afterRegistry).not.toMatch(/^## \d+\. /m);
  });
});

describe("029 FR-022 / FR-026: the amendment registry (US-009, US-010)", () => {
  it.skip("FR-026: registers the amendment and regenerates the index in one invocation", async () => {
    const { amendAtSection } = await loadAmend();

    const rec = await record(ADR_007_FIXTURE, ADR_007_FILE);
    const result = amendAtSection(rec, "2.1", {
      amendingId: "029",
      body: "Citations now resolve through the registry.",
    });

    // One call, one result carrying BOTH the insertion and the registry row —
    // the cascade is executed, not remembered.
    expect(result.amendment.amendingId).toBe("029");
    expect(result.amendment.at).toBe("2.1");
    const registry = result.content.slice(result.content.indexOf("## Amendments"));
    expect(registry).toMatch(/\|\s*029\s*\|/);
    expect(registry).toMatch(/\|\s*026\s*\|/);
  });

  it.skip("FR-022: creates the registry when the record carries none", async () => {
    const { registerAmendment } = await loadAmend();

    const noRegistry = ADR_007_FIXTURE.slice(
      0,
      ADR_007_FIXTURE.indexOf("## Amendments"),
    );
    const rec = await record(noRegistry, ADR_007_FILE);
    const content = registerAmendment(rec, {
      amendingId: "028",
      at: "2.1",
      summary: "Gate authority is one-way.",
    });

    // FR-022's executable assertion greps `^## Amendments`, so the heading is
    // literal and unnumbered (AMBER-2).
    expect(content).toMatch(/^## Amendments$/m);
    expect(content).toMatch(/\|\s*028\s*\|/);
    expect(content.indexOf("## Amendments")).toBeGreaterThan(
      content.indexOf("## 3. Impact Analysis"),
    );
  });

  it.skip("FR-022: is idempotent for an already-registered amending id", async () => {
    const { registerAmendment } = await loadAmend();

    const rec = await record(ADR_007_FIXTURE, ADR_007_FILE);
    const entry = {
      amendingId: "026",
      at: "2.1",
      summary: "Gate authority is one-way.",
    };

    const once = registerAmendment(rec, entry);
    const twice = registerAmendment({ ...rec, raw: once }, entry);

    expect((twice.match(/\|\s*026\s*\|/g) ?? []).length).toBe(1);
  });

  it.skip("FR-022: parses the existing registry into amendments", async () => {
    const rec = await record(ADR_007_FIXTURE, ADR_007_FILE);

    // The registry `--check` reads: assertion 2 resolves a `NNN correction`
    // citation against it, which is what closes D13.
    expect(rec.amendments.map((a) => a.amendingId)).toContain("026");
  });
});

describe("029 FR-023: ratification is modelled (US-011)", () => {
  it.skip("FR-023: flips Proposed to Decided and stamps the date", async () => {
    const { decide } = await loadAmend();

    const rec = await record(ADR_010_PROPOSED, "ADR-010-decision-records.md");
    const result = decide(rec, "2026-09-01");

    expect(result.content).toContain("**Status:** Decided");
    expect(result.content).not.toContain("**Status:** Proposed");
    expect(result.content).toContain("**Date:** 2026-09-01");
  });

  it.skip("FR-023: changes only the Status and Date lines", async () => {
    const { decide } = await loadAmend();

    const rec = await record(ADR_010_PROPOSED, "ADR-010-decision-records.md");
    const result = decide(rec, "2026-09-01");

    const changed = result.content
      .split("\n")
      .filter((line, i) => line !== rec.raw.split("\n")[i]);

    // A local file edit behind a command (RP-001) — no workflow, no dispatch,
    // and no collateral rewriting of the record.
    expect(changed.every((l) => /Status:|Date:/.test(l))).toBe(true);
    expect(result.content.length).toBeGreaterThanOrEqual(rec.raw.length - 1);
  });

  it.skip("FR-023: refuses to re-decide a Decided record", async () => {
    const { decide } = await loadAmend();

    const rec = await record(ADR_007_FIXTURE, ADR_007_FILE);

    expect(() => decide(rec, "2026-09-01")).toThrow(
      /ADR-007 is already Decided \(2026-05-22\)/,
    );
  });

  it.skip("FR-023: refuses a Superseded record", async () => {
    const { decide } = await loadAmend();

    const superseded = ADR_010_PROPOSED.replace(
      "**Status:** Proposed",
      "**Status:** Superseded",
    );
    const rec = await record(superseded, "ADR-010-decision-records.md");

    expect(() => decide(rec, "2026-09-01")).toThrow(
      /ADR-010 is Superseded; --decide does not apply/,
    );
  });
});
