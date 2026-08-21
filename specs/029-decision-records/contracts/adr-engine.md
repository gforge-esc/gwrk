# Contract: ADR Engine Modules

**Feature**: 029 Decision Records | **Spec**: [../spec.md](../spec.md) | **Plan**: [../plan.md](../plan.md)

Method-level contract for the five engine modules. Every method below is mapped to the plan phase that
implements it. All modules are **bare-clone operable** (TC-014): no SQLite, no build server, no network.

| Module | Phase |
|---|---|
| `src/engine/adr-parser.ts` | 1 |
| `src/engine/adr-scaffold.ts` | 2 |
| `src/engine/adr-index.ts` | 5 |
| `src/engine/adr-amend.ts` | 8 |
| `src/engine/adr-check.ts` | 10 |

---

## 1. Shared types

Defined in `src/engine/adr-parser.ts` unless noted. Plain TypeScript interfaces — **no Zod schema is
added or modified anywhere in this feature** (spec §11).

```ts
/** Status vocabulary is closed (FR-011). `Accepted`, `Rejected`, `Deprecated` are rejected. */
export type AdrStatus = "Proposed" | "Decided" | "Superseded";

/** A supersession edge as declared by the *forward* `Supersedes` field only (FR-012). */
export interface AdrSupersession {
  /** Target id when one is parseable, e.g. "ADR-001". Null for free-text forms. */
  targetId: string | null;
  /** The qualifier carried VERBATIM, e.g. "(storage mechanism only)" or
   *  "Partial aspects of ADR-002 §3 (Learning Loop Extraction)". Empty string when unqualified. */
  qualifier: string;
  /** The raw field value, for round-tripping. */
  raw: string;
}

/** The blockquote header block that follows the H1 (TC-007 — not YAML frontmatter). */
export interface AdrHeader {
  status: AdrStatus;
  /** ISO date as written, e.g. "2026-02-26". */
  date: string;
  /** Up to 240 characters, preserved verbatim; the index truncates for display (FR-004). */
  decision: string;
  /** One imperative sentence, MUST or MUST NOT. Absent on an unmigrated record (FR-010). */
  constraint: string | null;
  /** From `> **Decision Scope:**`. Projected into the index `Scope` column. */
  scope: string | null;
  author: string | null;
  /** Empty array when the field is absent — never a throw (ADR-001 carries neither). */
  dependsOn: string[];
  supersedes: AdrSupersession[];
}

/** One node of the heading tree (FR-005). */
export interface AdrHeading {
  /** Dotted section address as authored, e.g. "2", "2.1". Null for an unnumbered heading
   *  such as the `## Amendments` registry. */
  address: string | null;
  /** Markdown heading depth: 2 for `##`, 3 for `###`. */
  depth: number;
  title: string;
  /** 0-based line index of the heading itself. */
  line: number;
  /** 0-based line index one past the last line of this heading's body — the
   *  insertion point `--amend --at` uses (FR-020). */
  bodyEnd: number;
  children: AdrHeading[];
}

/** One entry of the final `## Amendments` registry (FR-022). */
export interface AdrAmendment {
  /** The amending record's id as written, e.g. "026", "028". Keyed by this (FR-022). */
  amendingId: string;
  /** Section address the amendment applies to, when the entry records one. */
  at: string | null;
  summary: string;
}

export interface AdrRecord {
  /** Zero-padded three-digit number, e.g. "010". Recovered from the FILENAME when the H1
   *  omits it, as ADR-001 and ADR-002 do (FR-004). */
  number: string;
  /** Canonical id, e.g. "ADR-010". */
  id: string;
  title: string;
  /** Absolute path on disk. */
  filePath: string;
  header: AdrHeader;
  headings: AdrHeading[];
  amendments: AdrAmendment[];
  /** Full file content, unmodified. */
  raw: string;
}
```

---

## 2. `src/engine/adr-parser.ts` — Phase 1 (FR-004, FR-005)

### `parseRecord(content: string, filename: string): AdrRecord`

Parses one record. **MUST** tolerate every documented corpus inconsistency:

| Input condition | Required behaviour |
|---|---|
| `# ADR: <title>` with the number only in the filename (001, 002) | Recover `number` from `filename` via `/^ADR-(\d{3})-/`; `title` from the H1 after the colon |
| `# ADR-00N: <title>` (003–009) | Number from the H1; filename agreement is not required |
| Trailing double-space hard breaks (001) | Stripped before field parsing; `decision` and other values carry no trailing whitespace |
| Neither `Supersedes` nor `Depends on` (001) | `dependsOn: []`, `supersedes: []` — **never** a throw |
| `> **Status:** Decided · **Date:** 2026-02-26` | Both fields extracted from the one line; the same applies to `Author` with `Decision Scope` |
| `Decision:` value up to 240 characters | Preserved verbatim; truncation is the index's concern, not the parser's |
| No blockquote header after the H1 | Throw with `` `<path>`: no blockquote header found after the H1 `` (FR-014 error states) |

**Throws** on an unparseable header only. An absent optional field is never an error.

### `parseCorpus(decisionsDir: string): Promise<AdrRecord[]>`

Reads every entry of `decisionsDir` matching `/^ADR-(\d{3})-.*\.md$/`. **MUST** filter on the `.md`
suffix **and** the pattern — a raw readdir is the research allocator's flaw (FR-002). Returns records
sorted ascending by `number`. A directory entry is skipped, not read.

### `resolveSection(record: AdrRecord, address: string): AdrHeading | null`

Resolves a dotted address (`"2.1"`) against `record.headings`. Returns `null` when no heading carries
that address — **never** a line-number fallback (FR-020). `resolveSection(adr007, "9.9")` returns
`null`; `resolveSection(adr007, "78")` returns `null` (OQ-001: `§78` is a line number dressed as an
address; the correct address is `§2.1`).

### `listSectionAddresses(record: AdrRecord): string[]`

Ordered, flattened list of every resolvable address. Consumed by the FR-020 error message
`` ADR-007 §9.9: no such section. Sections: 1, 2, 2.1, 2.2, 2.3, 3, … ``.

---

## 3. `src/engine/adr-scaffold.ts` — Phase 2 (FR-002, FR-003, FR-019)

### `findProjectRoot(cwd: string): Promise<string>`

Walks parent directories for `.gwrkrc.json`, as `init.ts` does. **MUST NOT** join `process.cwd()` with
literals — that is the third flaw of the research allocator, and it is what makes the command work from
any subdirectory (US-001 scenario 3).

**Throws** `` Not a gwrk project: no .gwrkrc.json found in <cwd> or any parent. Run: gwrk init `` (exit 1).

### `resolveDecisionsDir(projectRoot: string): Promise<string>`

Reads `project.architecture.decisions` from `loadConfig` (`config.ts:86-95` — declared today and read by
nothing), defaulting to `docs/decisions`. Handles the `z.union([z.string(), z.object({…})])` shape: a
bare string means the architecture doc, so `decisions` is only present on the object form. One
`loadConfig` call turns a declared-but-dead seam into the configuration point (FR-019).

### `allocateNumber(decisionsDir: string): Promise<string>`

Max+1 over entries matching `/^ADR-(\d{3})-/`, zero-padded to three. No locking (TC-015): two concurrent
runs compute the same number and `scaffold`'s existence check makes the second fail loudly.

### `renderTemplate(input: { number: string; title: string; date: string }): string`

Emits the §4.1 template:

1. `# ADR-<NNN>: <title>`
2. Blockquote header — `> **Status:** Proposed`, `> **Date:** <today>`, `> **Decision:**`,
   `> **Constraint:**`, optional `> **Depends on:**` / `> **Supersedes:**`,
   `> **Author:** … · **Decision Scope:** …`
3. `## 1. Context`
4. `## 2. Decision` with numbered assertion sub-headings (`### 2.1`, `### 2.2`, …)
5. `## 3. Decision Record` — the **four-row** `Position` / `Confidence` / `Reversibility` / `Risk` table
   used by 004–009. **MUST NOT** introduce a fourth table shape.
6. `## 4. Alternatives Rejected`
7. `## 5. Impact on Existing Code`
8. `## 6. Consequences`
9. `## 7. References`
10. `## Amendments` — **last, literal, unnumbered**, starting empty as the registry `--check` reads.

> **Heading-form note (plan AMBER-2).** FR-003 lists the registry as "§8", but FR-022's and US-009's
> executable assertions grep `^## Amendments`. The literal unnumbered heading is authoritative;
> "§8" denotes ordinal position. `appendSection`'s max+1 scan sees only `## N.` headings, so the
> registry does not disturb numbering.

### `scaffold(title: string, opts?: { cwd?: string }): Promise<AdrScaffoldResult>`

```ts
export interface AdrScaffoldResult {
  /** Absolute path written. */
  filePath: string;
  /** e.g. "ADR-010". */
  id: string;
  number: string;
  slug: string;
}
```

Order of operations: `findProjectRoot` → `resolveDecisionsDir` → `allocateNumber` → **existence check**
→ `mkdir` → `writeFile`.

| Condition | stderr contains | Exit |
|---|---|---|
| `ADR-NNN-*.md` exists at the computed number | `ADR-010 already exists: docs/decisions/ADR-010-<slug>.md` | 1 |
| No `.gwrkrc.json` in any parent | `Not a gwrk project: no .gwrkrc.json found in <cwd> or any parent. Run: gwrk init` | 1 |
| Empty title | `Title is required: gwrk define adr "<title>"` | 1 |
| `docs/decisions/` unwritable | `Cannot write docs/decisions/: <errno>` | 1 |

**On a collision `writeFile` MUST NOT be called** — asserted by TR-001. Writing a sibling at a taken
number is the second flaw of the research allocator.

---

## 4. `src/engine/adr-index.ts` — Phase 5 (FR-009, FR-011, FR-012, FR-014)

```ts
export interface AdrIndexRow {
  id: string;
  scope: string;
  /** Rendered status cell, e.g. "Decided" or
   *  "Decided · superseded in part by ADR-002 (storage mechanism only)" (FR-012). */
  status: string;
  constraint: string;
}

export interface AdrIndex {
  rows: AdrIndexRow[];
  /** Hash over the PARSED HEADERS, not raw bytes (DM-002). */
  hash: string;
}

export interface AdrIndexCheck {
  ok: boolean;
  /** Ids whose parsed header disagrees with the stored index. */
  divergent: string[];
  message: string | null;
}
```

### `buildIndex(records: AdrRecord[]): AdrIndex`

- **One row per record, never filtered by status** (FR-011). A `Status: Decided` filter would drop
  ADR-006 and ADR-007 — the two records defining the dispatch path any injection rides on (SC-006).
- `constraint` is projected from `header.constraint` (FR-010). A record without one renders an empty
  cell rather than being omitted.
- **Supersession back-references are derived** from forward `Supersedes` fields alone (FR-012). Given
  ADR-002's `Supersedes: ADR-001 (storage mechanism only)`, ADR-001's row gains
  `superseded in part by ADR-002 (storage mechanism only)` — the qualifier **verbatim**. No corpus edit
  records a back-reference, and `Superseded by` MUST NOT appear in `docs/decisions/`.
- A free-text form (ADR-003's `Supersedes: Partial aspects of ADR-002 §3 (Learning Loop Extraction)`)
  is preserved as written; when `targetId` is parseable the inverse edge is still derived.
- The bare word `superseded` MUST NOT appear alone in a row whose source qualifier was non-empty —
  flattening to a boolean would tell an agent to ignore ADR-001, whose Hard Gate Architecture is live
  and cited from ADR-005's own header.

### `renderIndex(index: AdrIndex): string`

Emits a three-line preamble, the header `| ADR | Scope | Status | Constraint |`, then one row per
record, then the hash as a trailing comment. **MUST** stay inside the 1000-token injection budget
(TC-010, SC-011, VR-008 — measured, not estimated).

### `hashCorpus(records: AdrRecord[]): string`

Stable over identical input; computed over parsed headers only, so prose edits below the header do not
report the index stale (DM-002). A mutated header **MUST** diverge.

### `writeIndex(projectRoot: string, records: AdrRecord[]): Promise<string>`

Writes `.gwrk/decisions/index.md`, creating `.gwrk/decisions/` if absent. Returns the path.

> The index **MUST NOT** live at `docs/decisions/INDEX.md`: `source-scanner.ts:57-69` readdirs that
> directory and would push the index into the ontology prompt, doubling the corpus there. Keeping the
> derived artifact under `.gwrk/` also keeps `docs/decisions/` purely human-authored (FR-013, TC-004).

### `checkIndex(projectRoot: string, records: AdrRecord[]): Promise<AdrIndexCheck>`

| Condition | stderr contains | Exit |
|---|---|---|
| Stored hash disagrees with the parsed corpus | `Decision index is stale. Run: gwrk define adr --reindex` | 1 |
| `.gwrk/decisions/index.md` absent under `--check` | `No decision index at .gwrk/decisions/index.md. Run: gwrk define adr --reindex` | 1 |
| A record's header is unparseable | `docs/decisions/ADR-0NN-<slug>.md: no blockquote header found after the H1` | 1 |

---

## 5. `src/engine/adr-amend.ts` — Phase 8 (FR-020, FR-021, FR-022, FR-023)

```ts
export interface AmendResult {
  /** Full-file content. IntentEngine executes only WRITE_FILE / CREATE_DIR / RUN_COMMAND —
   *  there is no patch or append verb (intent-engine.ts:54-119). */
  content: string;
  filePath: string;
  /** Registry entry added by this operation. */
  amendment: AdrAmendment;
}
```

### `amendAtSection(record: AdrRecord, address: string, opts: { amendingId: string; body: string }): AmendResult`

Inserts an inline correction blockquote at `heading.bodyEnd` of the addressed section — the form ADR-007
already uses at `:80` (`> **026 correction.**`), correct when the original sentence stays true in a
narrower reading. Placement resolves through `resolveSection`, **never** a line number.

Also calls `registerAmendment`, so the registry and the insertion land in one result (FR-026).

**Growth invariant.** The returned `content` **MUST** be longer than `record.raw`. The
`wouldShrinkExistingFile` guard (`workflow-runtime.ts:155-160`, `:490-501`) drops a shrinking write, and
path containment (`intent-engine.ts:59-64`) is satisfied by a path under the project root.

### `appendSection(record: AdrRecord, opts: { amendingId: string; title: string; body: string }): AmendResult`

Appends a new top-level section numbered **max+1 over existing `## N.` headings** — the form ADR-005
already uses (`## 8. Amendment: … (2026-03-16)` with `> **Amends:** §2.3, §2.4`), correct when the
change needs its own context and consequences. Inserted **before** the `## Amendments` registry, which
is unnumbered and therefore excluded from the max+1 scan.

Both forms stay; each is correct for a different kind of change.

### `registerAmendment(record: AdrRecord, entry: AdrAmendment): string`

Ensures a final `## Amendments` section exists and appends a row keyed by `entry.amendingId`. Idempotent
for an id already registered.

### `decide(record: AdrRecord, today: string): AmendResult`

Flips `Status: Proposed` → `Decided` and stamps `Date:`. **No workflow, no dispatch, and per RP-001 no
permission guard** — an agent can run it; ratification is human because the edit produces a diff, the
diff lands on a PR to `develop`, and a human merges.

| Condition | stderr contains | Exit |
|---|---|---|
| Already `Decided` | `ADR-010 is already Decided (2026-08-20)` | 1 |
| `Superseded` | `ADR-001 is Superseded; --decide does not apply` | 1 |

### Error states (FR-020 / FR-021)

| Condition | stderr contains | Exit |
|---|---|---|
| `--at <section>` resolves to no heading | `ADR-007 §9.9: no such section. Sections: 1, 2, 2.1, 2.2, 2.3, 3, …` | 1 |
| `<ADR-NNN>` resolves to no file | `ADR-042 not found in docs/decisions/` | 1 |
| `--amend` without `--at` or `--append-section` | `--amend requires --at <section> or --append-section` | 1 |
| Result would shrink the file | `Refusing to shrink docs/decisions/ADR-007-…md; an amendment must grow it` | 1 |

---

## 6. `src/engine/adr-check.ts` — Phase 10 (FR-024, FR-025)

```ts
export interface AdrCheckFinding {
  /** Repo-relative path of the citing file. */
  file: string;
  /** 1-indexed. */
  line: number;
  assertion: 1 | 2 | 3;
  message: string;
}

/** Directories excluded from the citation scan. Settles OQ-003. */
export const SCAN_IGNORE: readonly string[];
```

### `scanSurface(projectRoot: string): Promise<Citation[]>`

Roots `src/`, `docs/`, `specs/`. `SCAN_IGNORE` is
`["node_modules", "dist", ".git", ".claude", "cache", "docs/archive"]`.

**Citation-shape rule (plan AMBER-1 — settles OQ-003).** A literal reading of FR-024 can never exit 0:
this tree carries `ADR-030`, `ADR-042` and `ADR-099` as illustrative prose and error-message examples in
`specs/029-decision-records/spec.md`, its `checklists/requirements.md`, and
`docs/research/R012-adr-first-class/`. Measured facts: every bare `ADR-\d{3}` in `src/` resolves today,
and every link-shaped citation across all three roots resolves today (001–009 only). Therefore:

1. In `src/` (`.ts`, `.yaml`, `.md`): every bare `ADR-\d{3}` is a citation and MUST resolve.
2. In `docs/` and `specs/` markdown: only an **addressed** citation is checked — a markdown link whose
   target contains `ADR-NNN`, or a literal `docs/decisions/ADR-NNN…` path. A bare prose mention makes no
   address claim and is not checked.
3. A path containing an angle-bracket placeholder (`ADR-010-<slug>.md`) is a template, not an address,
   and is skipped.

### `checkCitations(projectRoot: string, records: AdrRecord[]): Promise<AdrCheckFinding[]>`

Exactly **three** assertions (OQ-001 deferred — no section-address assertion):

| # | Assertion | Failure message |
|---|---|---|
| 1 | Every citation per `scanSurface` resolves to a file in `docs/decisions/` | `<file>:<line>: ADR-099 does not resolve to a file in docs/decisions/` |
| 2 | Every `NNN correction` citation resolves to a **registered** amendment in the cited record's `## Amendments` | `<file>:<line>: cites a '028 correction' not registered in ADR-007's ## Amendments` |
| 3 | The index hash matches the parsed corpus headers | `Decision index is stale. Run: gwrk define adr --reindex` |

**Assertion 2 is what closes D13.** Against the pre-fix tree it reports
`src/engine/ship-orchestrator.ts:492` citing a `028 correction` that ADR-007 does not carry. A resolver
keyed only on `ADR-\d+` **passes** that citation, because `ADR-007` resolves — only the intra-record
address catches it (spec §0.2). One finding per line; exit 1 if any finding exists.

Per TC-005 this is a citation resolver over `docs/decisions/`, **not** a coupling to the plan graph: an
ADR is a document carrying a requirement-class id, and no requirement semantics are added. Per TC-006
nothing is added to `drift-detector`'s `getDriftArtifacts()`.
