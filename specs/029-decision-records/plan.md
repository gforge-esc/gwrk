# Implementation Plan: 029 Decision Records

**Branch**: `feat/decision-records` | **Date**: 2026-08-20 | **Spec**: [spec.md](./spec.md)

## Summary

Make architecture decision records a first-class gwrk artifact: `gwrk define adr` authors a numbered
record, a parser reads the nine that already exist, a derived index reaches every dispatch through the
ADR-009 grounding channel, amendment and ratification become modelled operations, and `--check` turns
the phantom `028 correction` at `ship-orchestrator.ts:492` (D13) into a CI failure.

The spec's four delivery phases expand to **eleven plan phases**, each ≤10 file changes, ordered so the
spec's phase boundaries stay verifiable:

| Spec phase | Plan phases | Value if it stops here |
|---|---|---|
| 1 — Author | 1, 2, 3 | Corpus stops drifting in shape; the next decision gets written (SC-012) |
| 2 — Index and inject | 4, 5, 6, 7 | Every dispatch learns what it may not do (SC-004) |
| 3 — Amend and check | 8, 9, 10 | D13 is closed by a mechanism, not a memory (SC-007) |
| 4 — Audit | 11 | Semantic contradiction gets reported (SC-010) |

Three departures from the spec's literal text are taken deliberately and recorded in
§Resolved Ambiguities below: the FR-024 scan rule (settles OQ-003), the `## Amendments` heading form,
and the atomic number claim TC-015's literal wording forbids. One correction applies to every phase gate in this document and is not optional.

---

## Gate-Form Correction (applies to every Done When block)

`src/utils/gate-exec.ts:138` runs a gate as `execSync("set -e\n" + script, { shell: "/bin/bash" })` —
`set -e`, no `pipefail`. Bash exempts a command **whose return value is inverted with `!`** from
`set -e`. Verified on this tree:

```
$ bash -c 'set -e; ! grep -q "x" package.json; echo REACHED'
REACHED     # exit 0 — the failed assertion did not fail the script
```

So the `! grep -q …` form the spec's acceptance scenarios use as prose is a **silent no-op** as a gate
line: it can never turn a phase red. Every negative assertion below is therefore written as

```bash
if grep -q 'forbidden pattern' path/to/file; then exit 1; fi
```

which `set -e` does honour (the `if` test is exempt, the explicit `exit 1` is not). For the same reason
the spec's two `head -1 "$f" | grep -qE …` scenarios are rewritten as
`awk 'NR==1{exit !/…/}' "$f"` — an exit code, not a pipe into `grep -q`, per the 023 assertion contract
(`docs/grounding/023-plan-format-contract.md` §Forbidden).

---

## Resolved Ambiguities

### 🟡 AMBER-1 — FR-024 assertion 1 cannot exit 0 under a literal reading (settles OQ-003)

FR-024 says "every `ADR-\d+` cited in `src/`, `docs/` or `specs/` resolves to a file in
`docs/decisions/`". Measured against this tree, the distinct ids present are 001–009 plus **ADR-010,
ADR-030, ADR-042, ADR-099**. The last three are illustrative — `roughly ADR-030` (TC-010, SC-011),
`` `ADR-042 not found in docs/decisions/` `` and `` `ADR-099 does not resolve …` `` (FR-020/FR-024 error
state tables) — and they live in `specs/029-decision-records/spec.md`, its `checklists/requirements.md`,
and `docs/research/R012-adr-first-class/`. A literal scan can therefore **never** satisfy SC-007's
"exits 0 after FR-006, FR-022 and FR-025 land".

Measured facts that make a precise rule available:

- Every bare `ADR-\d{3}` in `src/` (`.ts`, `.yaml`, `.md`) resolves today — 001–009 only.
- Every **link-shaped** citation across `src/`, `docs/`, `specs/` resolves today — 001–009 only.
- The only unresolved *addressed* citation is `docs/decisions/ADR-010-decision-records.md`
  (spec.md SC-003, R012 draft), which resolves once plan Phase 9 writes the record.
- `ADR-030`, `ADR-042`, `ADR-099` appear **only** as bare prose or inline-code mentions — never as a
  link target and never as a `docs/decisions/…` path.

**Rule the implementation MUST follow** (contracted in `contracts/adr-engine.md` §4):

1. Roots `src/`, `docs/`, `specs/`; ignore `node_modules/`, `dist/`, `.git/`, `.claude/`, `cache/`,
   `docs/archive/`.
2. In `src/` (`.ts`, `.yaml`, `.md`): every bare `ADR-\d{3}` MUST resolve.
3. In `docs/` and `specs/` markdown: only an **addressed** citation is checked — a markdown link whose
   target contains `ADR-NNN`, or a literal `docs/decisions/ADR-NNN…` path. A bare prose mention makes
   no address claim and is not checked.
4. A path containing an angle-bracket placeholder (`ADR-010-<slug>.md`) is a template, not an address,
   and is skipped.

D13 is unaffected: per spec §0.2 the phantom `028 correction` is caught by **assertion 2**, not
assertion 1. This is a documented refinement of FR-024's wording, not a scope reduction — narrowing it
further is the maintainer's call.

### 🟡 AMBER-2 — `## Amendments` heading form

FR-003 lists the registry as template "§8 Amendments", implying `## 8. Amendments`. But FR-022's and
US-009's **executable** assertions grep `^## Amendments`, which a numbered heading fails, and FR-021
numbers appended sections max+1 over existing `## N.` headings.

**Resolution**: the registry is the literal, unnumbered `## Amendments`, placed last. FR-003's "§8"
denotes ordinal position in the template listing, not a numbered heading — executable assertions win
over prose ordinals. FR-021's max+1 scan sees only `## N.` headings, so the registry does not disturb
numbering: ADR-005's next appended section is `## 13.` (after its existing §8–§12), inserted *before*
the registry.

### 🟡 AMBER-3 — TC-015's no-lockfile prohibition cannot deliver FR-002's outcome

TC-015 as written says "No locking", and names FR-002's existence check as what makes the second of two
concurrent runs fail loudly. Those two clauses contradict each other.

Measured on a real filesystem, 5 out of 5 two-process races produced two records at the same number:

- Both runs finish their re-read before either writes, so each sees the number free.
- `writeFile` with `flag: "wx"` refuses only an identical filename. A second slug at the same number
  sails past it.
- The result is `ADR-002-alpha-one.md` beside `ADR-002-beta-two.md`, both runs exiting 0. That is the
  silent-sibling flaw FR-002 exists to correct.

**Resolution**: FR-002's stated outcome wins over TC-015's stated mechanism. The number is taken in one
atomic step before the write. That step is a `.ADR-NNN.claim` published by `fs.link`, which the kernel
grants to exactly one writer. The claim is released in a `finally` on the way out. `allocateNumber`
counts a claimed number as held, so a claim a crashed run left behind costs the corpus one number
rather than wedging it.

TC-015's proportionality argument still forbids four things, and none of them are added here: a lock
manager, a daemon, a timeout, a retry loop. One `link` call and one `unlink`. Nothing waits.

Verified 5/5 on a real filesystem after the change: exactly one `ADR-002` lands, the loser exits 1 with
`ADR-002 already exists: docs/decisions/ADR-002-<slug>.md`, and no claim or stage file survives.
Regression-gated by the non-mocked suite in `src/engine/adr-scaffold.test.ts` (TR-001) and by the
Phase 2 Done-When consistency check, which fails if this departure is ever undocumented again.

### 🟡 AMBER-4 — TC-014's bare-clone tolerance covers an absent config, not an invalid one

`resolveDecisionsDir` shipped a bare `catch {}` around `loadConfig`, justified in the source as TC-014
bare-clone tolerance. It never handled that case.

`scaffold` calls `findProjectRoot` first, and that only returns a root holding a `.gwrkrc.json`. By the
time `resolveDecisionsDir` runs, the file is guaranteed present. The catch could only ever fire on
malformed JSON or a schema violation, and both are TC-002 fail-fast conditions. A bare clone carries the
committed `.gwrkrc.json` and parses fine, so TC-014 was never at stake.

Measured on the built CLI with a `.gwrkrc.json` setting `decisions` to `docs/adr` and omitting the
required `project.name`:

- `gwrk define adr "Configured Dir"` exited 0 and wrote `docs/decisions/ADR-001-configured-dir.md`,
  ignoring the configured directory with no message.
- `gwrk define adr "Split Brain" --run` wrote the record to the wrong directory **and then** exited 1
  with the schema error, because `draftRecord` calls the same `loadConfig` unguarded.

One command, one config, two contradictory answers about one `loadConfig` call.

**Resolution**: TC-002 fail-fast wins. The catch is narrowed to the file-absent message alone. Malformed
JSON and schema violations propagate, and `scaffold` surfaces them as exit 1 naming the config error,
matching `draftRecord`. TC-014's tolerance is preserved for the one case it describes: a direct
`resolveDecisionsDir` call against a root with no `.gwrkrc.json` still returns `docs/decisions`.

Regression-gated by the non-mocked block in `src/engine/adr-scaffold.test.ts`, which drives real
`scaffold()` calls against temp projects, and by a T006 gate line that scaffolds against a
schema-invalid config and fails on exit 0.

### 🟡 AMBER-5 — FR-003's "today's date" is the author's local date, not UTC

`scaffold()` stamped the record with `new Date().toISOString().slice(0, 10)`. `toISOString()` is UTC.

Measured on the built CLI at 2026-08-30 20:59 MDT: `gwrk define adr "Timezone Probe"` wrote
`> **Date:** 2026-08-31`, one day ahead of the author's today. Every record authored after 18:00 in
America/Denver is stamped tomorrow, a six-to-seven hour window each day.

Corpus ordering also stops being monotonic. A record authored at 19:00 on the 30th outranks one authored
at 09:00 on the 31st, and `Date:` is the only ordering signal a reader has once numbers are allocated by
a race.

**Resolution**: FR-003 means the author's local calendar date. `scaffold()` builds `YYYY-MM-DD` from
`getFullYear` / `getMonth` / `getDate`. `toISOString()` is banned for human-facing dates in this module,
and a T006 gate line fails on it.

Regression-gated by a non-mocked test that fakes a clock under `TZ=America/Denver` at an instant whose
UTC date has already rolled over, and by a T006 gate line that runs the built CLI under
`TZ=America/Denver` and compares the written `> **Date:**` value against `date +%Y-%m-%d`.

**Out of scope, filed**: `src/engine/plan-renderer.ts:33` carries the same UTC-for-a-human-date call.
Not Phase 2 work; recorded here as follow-up.

### Adopted spec recommendations

- **OQ-002** — `Superseded` stays **derived-only**; no status flip is written into a header until a
  fully superseded record exists. FR-011 keeps the vocabulary; FR-012 supplies the representation.
- **OQ-001** — `--check` keeps **three** assertions. `ADR-007 §78` (correctly `§2.1`) is not a class
  FR-024 covers; adding a fourth section-address assertion would fail on seven existing citations that
  must be corrected in the same change. Deferred — see Deferred Items.
- **VR-010** — satisfied structurally: `plan-to-tasks.ts:337-339` copies a fenced-bash Done-When block
  onto every task's `gateScript`. The 023 parser fix is present on this tree, so a fenced block is now
  the correct authoring form (the 026/027 finding described the pre-023 parser).

---

## Phases and File Structure

### Phase 1: Parser and corpus reconciliation

The parser is authored first and the corpus is reconciled to the shape it reads — in place, no file
rewritten, nothing deleted or reordered. Includes the W4 `028 correction` block on ADR-007, whose
markdown already exists at `docs/code-review-verdict-defect.md:422-431`. Tests are fixture-driven,
never the live corpus, so ADR-010 landing in Phase 9 cannot break them (TR-002).

**Files (6):**
- `src/engine/adr-parser.ts` — **create** — blockquote-header parser + heading-tree extractor, tolerating all four documented corpus inconsistencies (FR-004, FR-005)
- `src/engine/adr-parser.test.ts` — **create** — fixtures for two H1 styles, hard breaks, absent relations, `·` field separation, a 240-char `Decision:`, duplicate headings (TR-002)
- `docs/decisions/ADR-001-task-tracking.md` — **amend** — H1 → `# ADR-001: …`; deduplicate the two `## 7.` headings so section addressing is unambiguous
- `docs/decisions/ADR-002-sqlite-execution-ledger.md` — **amend** — H1 → `# ADR-002: …`; dead `file:///Users/gonzo/…` `Supersedes` link → relative path
- `docs/decisions/ADR-006-plugin-agent-backends.md` — **amend** — `Status: Proposed` → `Decided` (cited from `agent-backend.ts`, `manifest.ts`, `agent-registry.ts`, `agent.ts`)
- `docs/decisions/ADR-007-single-dispatch-path.md` — **amend** — `Status: Proposed` → `Decided`; add the W4 inline `028 correction` block (one-way gate authority), citing `docs/code-review-verdict-defect.md`

**Requirements Addressed:** FR-004, FR-005, FR-006 · US-002, US-010 · TC-007, TC-014

**Dependencies:** None. This phase ships alone.

**Contract Mapping:** `contracts/adr-engine.md` → `parseRecord`, `parseCorpus`, `resolveSection` → `src/engine/adr-parser.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-007 (single dispatch path) | This phase amends ADR-007's own text; it adds no dispatch path |
| TC-007 blockquote metadata, not YAML | Parser reads the house `> **Field:**` form shared with `plan-renderer.ts:33-38` |
| TC-014 bare-clone operable | Parsing requires no SQLite and no build server |
| VR-004 MPL header | Required by hand on `adr-parser.ts` — the pre-commit hook is absent in this clone |
| compile-gate | Always |

#### Test Strategy
| TR-### | Type | Target | Assertion |
|---|---|---|---|
| TR-002 | unit | `src/engine/adr-parser.test.ts` | Number recovered from the filename when the H1 omits it; trailing double-space hard breaks tolerated; absent `Supersedes`/`Depends on` yield empty relations rather than a throw; `·` splits two fields on one line; a 240-character `Decision:` survives verbatim; heading tree includes a duplicate-heading fixture; fixtures are the only input |
| TR-014 | gate | `docs/decisions/` | Reconciled H1s; no `file:///Users/gonzo` anywhere in the corpus; exactly one `## 7.` in ADR-001; no `Status: Proposed` in 006/007; ADR-007 carries the `028 correction`; no forward-recorded `Superseded by` |

#### Done When
```bash
pnpm run build
npx vitest run src/engine/adr-parser.test.ts
for f in docs/decisions/ADR-00*.md; do awk 'NR==1{exit !/^# ADR-00[1-9]: /}' "$f"; done
if grep -rq 'file:///Users/gonzo' docs/decisions/; then exit 1; fi
test "$(grep -c '^## 7\.' docs/decisions/ADR-001-task-tracking.md)" = 1
if grep -q 'Status:\*\* Proposed' docs/decisions/ADR-006-plugin-agent-backends.md; then exit 1; fi
if grep -q 'Status:\*\* Proposed' docs/decisions/ADR-007-single-dispatch-path.md; then exit 1; fi
grep -q '028 correction' docs/decisions/ADR-007-single-dispatch-path.md
grep -q 'is one-way' docs/decisions/ADR-007-single-dispatch-path.md
if grep -rq 'Superseded by' docs/decisions/; then exit 1; fi
```

---

### Phase 2: Scaffolder and `gwrk define adr`

The allocator fixes the three flaws of the research allocator: filter on the `.md` suffix **and** the
`ADR-NNN` pattern, fail loudly naming the conflicting path rather than writing a sibling, and discover
the project root by walking parents for `.gwrkrc.json`. The command declares neither `--refs` nor
`--dry-run` (TC-013) — the dry-run affordance is `--print` — so the nine-entry collision baseline holds
with no allowlist entry.

**Files (7):**
- `src/engine/adr-scaffold.ts` — **create** — root discovery, max+1 allocation, §4.1 template rendering, `project.architecture.decisions` honoured with a `docs/decisions` default (FR-002, FR-003, FR-019)
- `src/engine/adr-scaffold.test.ts` — **create** — `node:fs/promises` mocked wholesale; numbering, filter, collision refusal, root walk, config seam (TR-001)
- `src/commands/adr.ts` — **create** — exported `Command` + `adrCommandHandler`, `Examples:` help block, action wrapped in `withSignal("define adr", …)`, `--print` (FR-001, FR-008)
- `src/commands/adr.test.ts` — **create** — handler-level per `research.test.ts`: import the handler, mock the engine, assert the returned string (TR-003)
- `src/commands/define.ts` — **amend** — register `adrCommand` alongside `researchCommand`; add `adr` to the parent `define` `Examples:` block
- `src/cli.ux.test.ts` — **amend** — add `"define adr"` to `commandsWithExamples` at `:43-55` (TR-009)
- `src/cli.e2e.test.ts` — **amend** — assert `adr` appears in `define --help` at `:75-88`; `adr` is not in the `hidden` list, so asserting it is deliberate rather than incidental (TR-010)

**Requirements Addressed:** FR-001, FR-002, FR-003, FR-008, FR-019 · US-001 · TC-002, TC-013, TC-015 · SC-001

**Dependencies:** Phase 1 (the template must match the shape the parser reads).

**Contract Mapping:** `contracts/adr-engine.md` → `findProjectRoot`, `allocateNumber`, `renderTemplate`, `scaffold` → `src/engine/adr-scaffold.ts`; `contracts/adr-command.md` → `adrCommandHandler` → `src/commands/adr.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-004 (agent-native output) | `withSignal("define adr", …)` emits `[exit:N \| Xs]`. D12 records that `define research` omits this; FR-001 forbids copying that omission |
| TC-013 no option collisions | Neither `--refs` nor `--dry-run` declared; baseline stays at nine with no allowlist entry |
| TC-002 fail-fast config (AMBER-4) | `loadConfig` read with no `.default()`; missing project root exits 1 with the FR-002 message; a present-but-invalid `.gwrkrc.json` exits 1 naming the config error rather than defaulting |
| TC-015 no lock manager (AMBER-3) | Number taken by an atomic `.ADR-NNN.claim`, released on exit; no lock manager, daemon, timeout or retry loop |
| FR-003 local date (AMBER-5) | `> **Date:**` is the author's local calendar date; `toISOString()` banned for human-facing dates in `adr-scaffold.ts` |
| VR-004 MPL header | Required by hand on `adr-scaffold.ts` and `adr.ts` |
| compile-gate | Always |

#### Test Strategy
| TR-### | Type | Target | Assertion |
|---|---|---|---|
| TR-001 | unit | `src/engine/adr-scaffold.test.ts` | max+1 over an ADR-001…009 fixture; `.md`-suffix-and-pattern filter against a readdir containing directories and stray files; loud failure naming the conflicting path with `writeFile` never called; root discovery by walking parents for `.gwrkrc.json`; `project.architecture.decisions` honoured, `docs/decisions` default; non-mocked: the TC-015 race, real config resolution (AMBER-4), and a faked clock under `TZ=America/Denver` asserting the local date, not the UTC one (AMBER-5) |
| TR-003 | unit | `src/commands/adr.test.ts` | `adrCommandHandler` returns the written path; `--print` emits the template and writes nothing |
| TR-009 | unit | `src/cli.ux.test.ts` | `gwrk define adr --help` contains an `Examples:` section |
| TR-010 | integration | `src/cli.e2e.test.ts` | `adr` appears in `define --help` from the built CLI |
| — | gate | `src/cli.option-collisions.test.ts` | Regression: discovered-collision set still equals eight `HANDLED` plus one `VERIFIED_BENIGN` (TC-013, TR-015 no-op) |

#### Done When
```bash
pnpm run build
npx vitest run src/engine/adr-scaffold.test.ts src/commands/adr.test.ts
npx vitest run src/cli.ux.test.ts src/cli.e2e.test.ts src/cli.option-collisions.test.ts
node dist/cli.js define --help > .adr-help.log
grep -qE '^[[:space:]]+adr\b' .adr-help.log
node dist/cli.js define adr --help > .adr-sub-help.log
grep -q 'Examples:' .adr-sub-help.log
rm -f .adr-help.log .adr-sub-help.log
grep -q 'fs.link' src/engine/adr-scaffold.ts
grep -q 'AMBER-3' specs/029-decision-records/plan.md
grep -q 'ADR-NNN.claim' specs/029-decision-records/spec.md
grep -q 'ADR-NNN.claim' specs/029-decision-records/contracts/adr-engine.md
if grep -rq 'No lockin[g]' specs/029-decision-records/spec.md specs/029-decision-records/contracts specs/029-decision-records/checklists; then exit 1; fi
if grep -qi 'no lockfil[e]' specs/029-decision-records/plan.md; then exit 1; fi
grep -q 'AMBER-4' specs/029-decision-records/plan.md
grep -q 'AMBER-4' specs/029-decision-records/contracts/adr-engine.md
if grep -q 'catch {}' src/engine/adr-scaffold.ts; then exit 1; fi
ADRCLI="$PWD/dist/cli.js"
ADRTMP=$(mktemp -d)
printf '%s' '{"project":{"architecture":{"decisions":"docs/adr"}}}' > "$ADRTMP/.gwrkrc.json"
ADRCODE=0
( cd "$ADRTMP" && node "$ADRCLI" define adr "Gate Invalid Config" ) || ADRCODE=$?
if [ "$ADRCODE" -eq 0 ] || [ -d "$ADRTMP/docs/decisions" ]; then rm -rf "$ADRTMP"; exit 1; fi
rm -rf "$ADRTMP"
if grep -q 'toISOString().slice(0, 10)' src/engine/adr-scaffold.ts; then exit 1; fi
grep -q 'AMBER-5' specs/029-decision-records/plan.md
grep -q 'AMBER-5' specs/029-decision-records/contracts/adr-engine.md
ADRTZ=America/Denver
ADRTZTMP=$(mktemp -d)
printf '%s' '{"project":{"name":"gate-tz"}}' > "$ADRTZTMP/.gwrkrc.json"
( cd "$ADRTZTMP" && TZ=$ADRTZ node "$ADRCLI" define adr "Gate TZ" ) || { rm -rf "$ADRTZTMP"; exit 1; }
ADRTZFILE=$(ls "$ADRTZTMP"/docs/decisions/ADR-001-*.md 2>/dev/null | head -1)
ADRTZWRITTEN=$(grep -m1 '^> \*\*Date:\*\*' "$ADRTZFILE" | sed 's/.*Date:\*\* *//')
ADRTZEXPECT=$(TZ=$ADRTZ date +%Y-%m-%d)
rm -rf "$ADRTZTMP"
if [ -z "$ADRTZWRITTEN" ] || [ "$ADRTZWRITTEN" != "$ADRTZEXPECT" ]; then exit 1; fi
```

---

### Phase 3: `gwrk-adr-record` builtin and `--run` dispatch

One new workflow, dispatched through `WorkflowRuntime` — never a raw spawn (ADR-007). `projectRoot` is
passed deliberately, diverging from `define research --run`, which omits it and so falls back to a
default `PluginLoader` with no `projectDir`, making project-local overrides invisible. Without `--run`
no runtime is constructed. **This phase closes the spec's Phase 1 and proves SC-012 and VR-006**: no
grounding change, no prompt change, no index.

**Files (4):**
- `src/plugins/builtins/workflows/gwrk-adr-record/manifest.yaml` — **create** — `name: gwrk-adr-record`, version `1.0.0`, `outputSchema` with `required: [summary, intents]`
- `src/plugins/builtins/workflows/gwrk-adr-record/PROMPT.md` — **create** — drafting instructions with **no** substitution placeholders (TC-008)
- `src/commands/adr.ts` — **amend** — `--run` dispatches `gwrk-adr-record` via `WorkflowRuntime.executeWorkflow` with the title, `{agent, model}` and `projectRoot` (FR-007)
- `src/commands/adr-dispatch.test.ts` — **create** — per `research-dispatch.test.ts`: mock `WorkflowRuntime`, `node:fs/promises`, `loadConfig`, `resolveModelForTask` (TR-004)

**Requirements Addressed:** FR-007 · US-003 · TC-008, TC-011, TC-012 · SC-010, SC-012 · VR-006

**Dependencies:** Phase 2 (`--run` extends the command that phase creates).

**Contract Mapping:** `contracts/adr-command.md` → `adrCommandHandler({ run: true })` → `src/commands/adr.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-007 (single dispatch path) | Dispatch through `WorkflowRuntime` only; no raw `spawn` |
| ADR-006 (plugin agent backends) | `{agent, model}` resolved via `loadConfig` + `resolveModelForTask`, not a hardcoded default |
| TC-008 no placeholder substitution | `PROMPT.md` carries no `{{TOKEN}}`; context arrives as appended text |
| TC-011 nothing named "cascade" | Workflow is `gwrk-adr-record`; `gwrk-cascade-sync` stays untouched |
| TC-012 builtins ship through the build | `pnpm run build` + `postbuild` must copy the tree into `dist/` before any `dist/` assertion |
| compile-gate | Always |

#### Test Strategy
| TR-### | Type | Target | Assertion |
|---|---|---|---|
| TR-004 | unit | `src/commands/adr-dispatch.test.ts` | `executeWorkflow` receives `gwrk-adr-record`, an input containing the title, `{agent, model}`, and `projectRoot`; the `WorkflowRuntime` constructor is never called without `--run` |
| TR-014 | gate | `src/plugins/builtins/workflows/gwrk-adr-record/` | Manifest and prompt present in `dist/` after build; `required: [summary, intents]` declared; no `{{PLACEHOLDER}}` in the prompt |
| — | gate | Phase-1 boundary (VR-006) | The Phase 1–3 suites pass with no index present, no grounding change and no prompt change |

#### Done When
```bash
pnpm run build
npx vitest run src/commands/adr-dispatch.test.ts
test -f dist/plugins/builtins/workflows/gwrk-adr-record/manifest.yaml
test -f dist/plugins/builtins/workflows/gwrk-adr-record/PROMPT.md
grep -q 'required: \[summary, intents\]' src/plugins/builtins/workflows/gwrk-adr-record/manifest.yaml
if grep -qE '\{\{[A-Z_]+\}\}' src/plugins/builtins/workflows/gwrk-adr-record/PROMPT.md; then exit 1; fi
grep -q '## 7. References' src/plugins/builtins/workflows/gwrk-adr-record/PROMPT.md
grep -q '## Amendments' src/plugins/builtins/workflows/gwrk-adr-record/PROMPT.md
pnpm exec biome check src/commands/adr.ts
test ! -f .gwrk/decisions/index.md
npx vitest run src/engine/adr-parser.test.ts src/engine/adr-scaffold.test.ts src/commands/adr.test.ts
```

---

### Phase 4: `Constraint:` field across the nine records

One imperative sentence per record — `MUST` or `MUST NOT` — lifted from that record's `Decision Record`
block (present in 004–009) and authored for 001–003. The field is **authored, not derived**: it is not
in the header today. ADR-007's is the motivating case (SC-005): its `Decision:` line says all dispatch
flows through `WorkflowRuntime`, which does not tell an implementer that a `spawn("claude")` is
forbidden. The one-sentence cap is what defers the injection-budget ceiling to roughly ADR-030 (TC-010).

**Files (9):**
- `docs/decisions/ADR-001-task-tracking.md` — **amend** — add `> **Constraint:**` (Hard Gate Architecture is live; storage mechanism only is superseded)
- `docs/decisions/ADR-002-sqlite-execution-ledger.md` — **amend** — add `> **Constraint:**`
- `docs/decisions/ADR-003-state-contract.md` — **amend** — add `> **Constraint:**`
- `docs/decisions/ADR-004-agent-native-output.md` — **amend** — add `> **Constraint:**` (every command MUST emit `[exit:N | Xs]`)
- `docs/decisions/ADR-005-tdd-gate-architecture.md` — **amend** — add `> **Constraint:**`
- `docs/decisions/ADR-006-plugin-agent-backends.md` — **amend** — add `> **Constraint:**`
- `docs/decisions/ADR-007-single-dispatch-path.md` — **amend** — add `> **Constraint:**` (MUST NOT spawn an agent CLI directly; dispatch MUST go through `WorkflowRuntime`)
- `docs/decisions/ADR-008-command-safety-posture.md` — **amend** — add `> **Constraint:**`
- `docs/decisions/ADR-009-domain-ontology-information-hierarchy-ux.md` — **amend** — add `> **Constraint:**`

**Requirements Addressed:** FR-010 · US-005 · TC-010 · SC-005

**Dependencies:** Phase 1 (H1s and statuses reconciled first, so the header block is well-formed).

**Contract Mapping:** `contracts/adr-engine.md` §1 `AdrHeader.constraint` → consumed by `src/engine/adr-index.ts` in Phase 5

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| TC-007 blockquote metadata | `> **Constraint:**` joins the existing house header fields; no YAML frontmatter |
| TC-010 injection budget | One sentence per record; roughly 35 tokens each |
| FR-011 status vocabulary | `Proposed \| Decided \| Superseded` only — no `Accepted`, `Rejected` or `Deprecated` introduced |
| compile-gate | Always (no source change; build still asserted) |

#### Test Strategy
| TR-### | Type | Target | Assertion |
|---|---|---|---|
| TR-014 | gate | `docs/decisions/` | All nine records carry `> **Constraint:**`; no record carries a `Status:` outside the FR-011 vocabulary |
| TR-002 | unit | `src/engine/adr-parser.test.ts` | Regression: the parser still reads every fixture with the new field present |

#### Done When
```bash
for f in docs/decisions/ADR-00*.md; do grep -q '^> \*\*Constraint:\*\*' "$f"; done
if grep -rqE '^> \*\*Status:\*\* (Accepted|Rejected|Deprecated)' docs/decisions/; then exit 1; fi
pnpm run build
npx vitest run src/engine/adr-parser.test.ts
```

---

### Phase 5: Index generator, `--reindex`, `--reindex --check`

`.gwrk/decisions/index.md` is generated at **command time** — after any write, on `--reindex` alone, and
from `gwrk init` (Phase 6). One row per record, **never filtered by status**: a `Decided` filter would
drop ADR-006 and ADR-007, the two records defining the dispatch path any injection rides on (SC-006).
Supersession is carried as a row annotation with the qualifier verbatim and the inverse edge **derived**
from the forward `Supersedes` field, so no corpus edit records a back-reference. The content hash is
computed over **parsed headers**, not raw bytes, so prose edits below the header do not report the index
stale (DM-002).

**Files (3):**
- `src/engine/adr-index.ts` — **create** — row projection, `| ADR | Scope | Status | Constraint |` rendering, derived back-references, header hash, `--check` comparison (FR-009, FR-011, FR-012, FR-014)
- `src/engine/adr-index.test.ts` — **create** — nine-record fixture including two `Proposed`; header shape; no status filtering; `Constraint` projection; both supersession qualifier forms; hash stability and divergence; TC-010 token budget (TR-005)
- `src/commands/adr.ts` — **amend** — `--reindex`, `--reindex --check`, and post-write regeneration on every mutating invocation (FR-026)

**Requirements Addressed:** FR-009, FR-011, FR-012, FR-014, FR-026 · US-005, US-006, US-008 · DM-001, DM-002 · TC-004, TC-010 · SC-006, SC-008, SC-011 · VR-008

**Dependencies:** Phase 1 (parser), Phase 4 (`Constraint:` present in the live corpus).

**Contract Mapping:** `contracts/adr-engine.md` → `buildIndex`, `renderIndex`, `hashCorpus`, `writeIndex`, `checkIndex` → `src/engine/adr-index.ts`; `contracts/adr-command.md` → `--reindex`, `--reindex --check` → `src/commands/adr.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| TC-004 no fifth carrier | The index is a derived projection of `docs/decisions/`; it MUST NOT live at `docs/decisions/INDEX.md`, which `source-scanner.ts:57-69` would readdir into the ontology prompt |
| TC-010 injection budget | Token-budget assertion against the ~380-token figure and the 1,000-token revisit threshold (VR-008 — measured, not estimated) |
| DM-001 no spine node | No table, no `plan_features` row, no `tasks.json` entry; a `plan_proposals`-style approval table is forbidden (TC-007 of the source) |
| TC-014 bare-clone operable | Indexing needs no SQLite and no build server |
| VR-004 MPL header | Required by hand on `adr-index.ts` |
| compile-gate | Always |

#### Test Strategy
| TR-### | Type | Target | Assertion |
|---|---|---|---|
| TR-005 | unit | `src/engine/adr-index.test.ts` | Nine rows from a nine-record fixture with two `Proposed`, none omitted for status; `\| ADR \| Scope \| Status \| Constraint \|` header emitted; `Constraint` projected per row; ADR-002's parenthetical and ADR-003's free-text supersession qualifiers carried verbatim onto the superseded row; no fixture records its own back-reference; identical input hashes identically; a mutated header diverges; rendered index stays inside the 1000-token budget |
| — | gate | `.gwrk/decisions/index.md` | `--reindex` writes the index; `--reindex --check` exits 0 immediately after |

#### Done When
```bash
pnpm run build
npx vitest run src/engine/adr-index.test.ts
node dist/cli.js define adr --reindex
test -f .gwrk/decisions/index.md
grep -q '| ADR | Scope | Status | Constraint |' .gwrk/decisions/index.md
test "$(grep -cE '^\| ADR-0[0-9]{2} ' .gwrk/decisions/index.md)" = 9
grep -q 'ADR-006' .gwrk/decisions/index.md
grep -q 'ADR-007' .gwrk/decisions/index.md
node dist/cli.js define adr --reindex --check
```

---

### Phase 6: Grounding injection, `gwrk init`, and the scanner field split

A fourth entry joins the `groundingFiles` array at `agent.ts:567-581`, injected **uniformly** — no scope
filter, no stage gate — so IMPLEMENT and all four review stages receive it (SC-004); they carry zero
decision references today. Fail-open behaviour is inherited verbatim from the three existing rows
(TC-016): a missing file is skipped silently, an unreadable one warns dimly while dispatch continues.
Detection of absence belongs to `--reindex --check`, not to dispatch. Separately, `source-scanner` stops
pushing nine architecture decisions into `material.patterns`, where `define-ontology.ts:48-49` renders
them as `## Code Patterns`.

**Files (8):**
- `src/utils/agent.ts` — **amend** — fourth `groundingFiles` entry: `.gwrk/decisions/index.md` → `<architecture_decisions>` (FR-013)
- `src/utils/agent.grounding-decisions.test.ts` — **create** — injection present, absent-skips-silently, unreadable-warns-and-continues, payload identical across stages (TR-008)
- `src/commands/init.ts` — **amend** — generate the index when `docs/decisions/` is non-empty, near the scaffold block at `:429-441` (FR-017)
- `src/commands/init.test.ts` — **amend** — index written when the directory is non-empty, none written when empty (TR-013)
- `src/engine/source-scanner.ts` — **amend** — add `material.decisions`; stop pushing ADRs into `material.patterns` at `:57-69` (FR-015)
- `src/engine/source-scanner.test.ts` — **amend** — decisions land in `material.decisions`, `material.patterns` no longer receives them (TR-011)
- `src/commands/define-ontology.ts` — **amend** — render decisions under their own heading rather than `## Code Patterns` at `:48-49`; on this path the index replaces the corpus (FR-015)
- `src/commands/define-ontology.test.ts` — **amend** — decisions render under their own heading (TR-011)

**Requirements Addressed:** FR-013, FR-015, FR-017 · US-004, US-007, US-008 · TC-009, TC-016 · SC-004

**Dependencies:** Phase 5 (the index must exist to be injected).

**Contract Mapping:** `contracts/adr-command.md` §3 grounding-injection contract → `src/utils/agent.ts`; §4 `material.decisions` → `src/engine/source-scanner.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-009 (project knowledge grounding) | A fourth row on the array ADR-009 established, inheriting its fail-open behaviour verbatim |
| TC-009 uniform injection | No scope or stage filter added; a definition-only gate would exclude IMPLEMENT and review |
| TC-016 fail-open, deliberately inherited | Missing → silent skip; unreadable → dim warning, dispatch continues |
| Shared-type compatibility | `material.decisions` is additive; `material.patterns` survives with a narrower population, so other readers keep compiling |
| VR-009 not verified by ship | This phase changes the payload every dispatch receives, including the review dispatches that would judge it — human verification only |
| compile-gate | Always |

#### Test Strategy
| TR-### | Type | Target | Assertion |
|---|---|---|---|
| TR-008 | unit | `src/utils/agent.grounding-decisions.test.ts` | `<architecture_decisions>` wraps the index content in the stdin payload when the file exists; absent → tag absent, no warning, dispatch proceeds; unreadable → dispatch continues; the grounding array carries exactly four entries and no scope parameter; payload identical across stages |
| TR-013 | unit | `src/commands/init.test.ts` | `gwrk init` writes the index when `docs/decisions/` is non-empty and writes none when it is empty |
| TR-011 | unit | `src/engine/source-scanner.test.ts`, `src/commands/define-ontology.test.ts` | ADRs land in `material.decisions`, not `material.patterns`; the ontology grounding material renders decisions under their own heading |

#### Done When
```bash
pnpm run build
npx vitest run src/utils/agent.grounding-decisions.test.ts src/commands/init.test.ts
npx vitest run src/engine/source-scanner.test.ts src/commands/define-ontology.test.ts
grep -q 'architecture_decisions' src/utils/agent.ts
grep -q '.gwrk/decisions/index.md' src/utils/agent.ts
if grep -q 'material.patterns.push' src/engine/source-scanner.ts; then exit 1; fi
grep -q 'decisions' src/commands/define-ontology.ts
```

---

### Phase 7: Stale citation replacement

Three hardcoded ADR enumerations stop at ADR-004 or ADR-006 and carry dead `file:///Users/gonzo/…`
links; a fourth pointer routes "Architecture decisions" to `decision-forge`, a skill that does not
exist. All four become index references. `architecture.md` is the highest-leverage of them, since
`gwrk-specify/PROMPT.md:25` loads that file on every specify run. Because no substitution engine exists
(TC-008), the index reaches a prompt by file read and reaches a dispatch by the
`<architecture_decisions>` tag — the two mechanisms `gwrk-plan/PROMPT.md:102` and
`gwrk-specify/PROMPT.md:29` already use for ADR-004. Exactly one hand-written pointer line is added to
`.gwrk/agent-context.md`: `syncGovernance` replaces the whole marker block with the whole file, so a
generated index there would either destroy the six hand-written lines or require a composer.

**Files (6):**
- `src/engine/plan-renderer.ts` — **amend** — the `> **Decisions:**` line at `:38` becomes one index link, no per-ADR enumeration (FR-016)
- `src/engine/plan-renderer.test.ts` — **amend** — rendered build-plan header carries one index link and no enumeration (TR-012)
- `src/plugins/builtins/workflows/gwrk-plan/PROMPT.md` — **amend** — `:60-65` becomes a read-the-index instruction plus an `<architecture_decisions>` reference; `:147` routes "Architecture decisions" to the index, not `decision-forge`
- `src/plugins/builtins/workflows/gwrk-specify/PROMPT.md` — **amend** — add the index to the architecture-reference load list
- `docs/grounding/architecture.md` — **amend** — replace the `:4`, `:19-24` and `:206` anchors and their dead `file:///Users/gonzo/…` links with the index reference and relative links
- `.gwrk/agent-context.md` — **amend** — exactly one hand-written line naming `.gwrk/decisions/index.md` as authoritative (FR-018)

**Requirements Addressed:** FR-016, FR-018 · US-007 · TC-008 · SC-009

**Dependencies:** Phase 5 (the index path must be real before anything points at it).

**Contract Mapping:** `contracts/adr-command.md` §5 citation-surface contract → `src/engine/plan-renderer.ts`, both prompts, `docs/grounding/architecture.md`, `.gwrk/agent-context.md`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| TC-008 no placeholder substitution | Prompts reach the index by file read or the `<architecture_decisions>` tag; no `{{TOKEN}}` interpolation |
| TC-012 builtins ship through the build | Both `PROMPT.md` edits require `pnpm run build` to reach `dist/` |
| 023 plan-format contract | Only `plan-renderer.ts`'s **header** changes — the `> **Decisions:**` line. No phase, task or `Requirements Addressed:` grammar is touched (verified by TR-012) |
| FR-018 single pointer line | One line, no generator — `syncGovernance` replaces the whole marker block, so ownership must stay hand-written |
| compile-gate | Always |

#### Test Strategy
| TR-### | Type | Target | Assertion |
|---|---|---|---|
| TR-012 | unit | `src/engine/plan-renderer.test.ts` | The rendered build-plan header links the decision index and enumerates no ADRs; no other header field moves |
| TR-014 | gate | prompts, `architecture.md`, `.gwrk/agent-context.md` | Index reference present in both prompts and `architecture.md`; `decision-forge` gone; no `file:///Users/gonzo` in `architecture.md`; exactly one index reference in `.gwrk/agent-context.md` |

#### Done When
```bash
pnpm run build
npx vitest run src/engine/plan-renderer.test.ts
if grep -q 'ADR-005-tdd-gate-architecture.md), \[ADR-006' src/engine/plan-renderer.ts; then exit 1; fi
grep -q '.gwrk/decisions/index.md' src/plugins/builtins/workflows/gwrk-plan/PROMPT.md
grep -q 'architecture_decisions' src/plugins/builtins/workflows/gwrk-plan/PROMPT.md
if grep -q 'decision-forge' src/plugins/builtins/workflows/gwrk-plan/PROMPT.md; then exit 1; fi
grep -q '.gwrk/decisions/index.md' src/plugins/builtins/workflows/gwrk-specify/PROMPT.md
if grep -q 'file:///Users/gonzo' docs/grounding/architecture.md; then exit 1; fi
grep -q '.gwrk/decisions/index.md' docs/grounding/architecture.md
test "$(grep -c '.gwrk/decisions/index.md' .gwrk/agent-context.md)" = 1
```

---

### Phase 8: Amend, append-section, registry, and ratification

Two amendment forms, each correct for a different kind of change: the inline correction blockquote
ADR-007 already uses at `:80` (`> **026 correction.**`), placed at the end of the addressed section's
body with the address resolved through the **parsed heading tree, never a line number**; and the
appended top-level section ADR-005 already uses (`## 8. Amendment: …`), numbered max+1 over existing
`## N.` headings. Both emit a full-file `WRITE_FILE`, because `IntentEngine` executes only `WRITE_FILE`,
`CREATE_DIR` and `RUN_COMMAND` with no patch or append verb; the `wouldShrinkExistingFile` guard is
satisfied because an amendment always grows the file. `--decide` flips `Proposed` to `Decided`, stamps
the date and regenerates the index, with no workflow and no dispatch — and per RP-001 **ships no
permission guard**: ratification is human because the edit produces a diff, the diff lands on a PR to
`develop`, and a human merges.

**Files (6):**
- `src/engine/adr-amend.ts` — **create** — section-addressed insertion, `--append-section` numbering, `## Amendments` registry maintenance, full-file `WRITE_FILE` intent (FR-020, FR-021, FR-022)
- `src/engine/adr-amend.test.ts` — **create** — insertion at the end of §2.1's body against an ADR-007 fixture, heading-tree resolution, `§9.9` failure, max+1 numbering, growth guard, registry + reindex in one invocation (TR-007)
- `src/commands/adr.ts` — **amend** — `<ADR-NNN> --amend --at <section>`, `--append-section`, `--decide`; every mutating path regenerates the index (FR-023, FR-026)
- `src/commands/adr.test.ts` — **amend** — `--decide` flips and stamps, dispatches no workflow, regenerates the index; refuses an already-`Decided` record and a `Superseded` one (TR-003)
- `docs/decisions/ADR-005-tdd-gate-architecture.md` — **amend** — add the final `## Amendments` registry listing its appended sections §8–§12
- `docs/decisions/ADR-007-single-dispatch-path.md` — **amend** — add the final `## Amendments` registry listing the inline `026 correction` and the `028 correction` landed in Phase 1

**Requirements Addressed:** FR-020, FR-021, FR-022, FR-023, FR-026 · US-009, US-011 · RP-001 · SC-007 (precondition)

**Dependencies:** Phase 1 (heading tree, and the `028 correction` block the registry lists), Phase 5 (index regeneration).

**Contract Mapping:** `contracts/adr-engine.md` → `amendAtSection`, `appendSection`, `registerAmendment`, `decide` → `src/engine/adr-amend.ts`; `contracts/adr-command.md` → `--amend --at`, `--append-section`, `--decide` → `src/commands/adr.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| RP-001 no permission theatre | `--decide` ships **no** guard. An agent can run it; the diff plus PR review is the human gate |
| `IntentEngine` verb set | Full-file `WRITE_FILE` only — no patch or append verb exists (`intent-engine.ts:54-119`) |
| `wouldShrinkExistingFile` guard | An amendment must grow the file (`workflow-runtime.ts:155-160`, `:490-501`); path containment holds for a path under the project root |
| AMBER-2 heading form | Registry is the literal unnumbered `## Amendments`, placed last; FR-021's max+1 scans `## N.` headings only |
| VR-004 MPL header | Required by hand on `adr-amend.ts` |
| compile-gate | Always |

#### Test Strategy
| TR-### | Type | Target | Assertion |
|---|---|---|---|
| TR-007 | unit | `src/engine/adr-amend.test.ts` | Insertion lands at the end of §2.1's body; the address resolves through the heading tree, not a line number; `--at 9.9` exits non-zero naming the unresolvable address and listing available sections; `--append-section` numbers max+1 over existing `## N.` headings; the emitted intent is a full-file `WRITE_FILE` that grows the file; registry update and index regeneration happen in one invocation |
| TR-003 | unit | `src/commands/adr.test.ts` | `--decide` flips `Proposed` → `Decided`, stamps the date, regenerates the index, constructs no `WorkflowRuntime`; refuses an already-`Decided` record; refuses a `Superseded` one |
| TR-014 | gate | `docs/decisions/` | ADR-005 and ADR-007 each carry `## Amendments`; ADR-007's registry names both `026` and `028` |

#### Done When
```bash
pnpm run build
npx vitest run src/engine/adr-amend.test.ts src/commands/adr.test.ts
grep -q '^## Amendments' docs/decisions/ADR-005-tdd-gate-architecture.md
grep -q '^## Amendments' docs/decisions/ADR-007-single-dispatch-path.md
grep -A 20 '^## Amendments' docs/decisions/ADR-007-single-dispatch-path.md > .adr-registry.log
grep -q '026' .adr-registry.log
grep -q '028' .adr-registry.log
rm -f .adr-registry.log
node dist/cli.js define adr --reindex --check
```

---

### Phase 9: ADR-010, written by the command this feature ships

SC-003: the feature records its own decision using its own machinery. The record is produced by running
the shipped CLI — `node dist/cli.js define adr "Decision Records" --run` — then finished by hand, so
the scaffolder, the template, the `Constraint:` convention, the registry section and the post-write
reindex are all exercised end to end on the real corpus rather than on fixtures.

This phase is sequenced **before** Phase 10 deliberately: `docs/decisions/ADR-010-decision-records.md`
is cited as a literal path in `specs/029-decision-records/spec.md` (SC-003) and in
`docs/research/R012-adr-first-class/draft.md:496`, so under AMBER-1's addressed-citation rule
`define adr --check` cannot exit 0 until the record exists.

**Files (1):**
- `docs/decisions/ADR-010-decision-records.md` — **create** — authored by `gwrk define adr "Decision Records"`; records the carrier ranking (no fifth carrier, TC-004), the document-not-requirement position (TC-005), blockquote-over-YAML (TC-007), uniform injection (TC-009), and derived-only supersession (OQ-002)

**Requirements Addressed:** SC-003 · US-001 (end-to-end proof) · FR-001, FR-002, FR-003, FR-019 (exercised on the live corpus)

**Dependencies:** Phase 2 (the command), Phase 4 (`Constraint:` convention), Phase 5 (post-write reindex), Phase 8 (`## Amendments` registry form).

**Contract Mapping:** `contracts/adr-command.md` §1 `gwrk define adr "<title>"` → `docs/decisions/ADR-010-decision-records.md`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| FR-002 allocation | ADR-010 must be allocated max+1 by the command, not chosen by hand |
| FR-026 executed cascade | The write regenerates the index in the same invocation — not remembered |
| TC-004 no fifth carrier | The record lives in `docs/decisions/`; the index remains derived |
| AMBER-1 precondition | This record is what makes Phase 10's clean `--check` reachable |
| compile-gate | Always |

#### Test Strategy
| TR-### | Type | Target | Assertion |
|---|---|---|---|
| TR-014 | gate | `docs/decisions/ADR-010-decision-records.md` | H1 is `# ADR-010: …`; `> **Constraint:**` present; final `## Amendments` section present; the record appears in the regenerated index |
| TR-005 | unit | `src/engine/adr-index.test.ts` | Regression: the generator still satisfies the token budget with a tenth record |

#### Done When
```bash
pnpm run build
test -f docs/decisions/ADR-010-decision-records.md
awk 'NR==1{exit !/^# ADR-010: /}' docs/decisions/ADR-010-decision-records.md
grep -q '^> \*\*Constraint:\*\*' docs/decisions/ADR-010-decision-records.md
grep -q '^## Amendments' docs/decisions/ADR-010-decision-records.md
node dist/cli.js define adr --reindex
grep -q 'ADR-010' .gwrk/decisions/index.md
node dist/cli.js define adr --reindex --check
npx vitest run src/engine/adr-index.test.ts
```

---

### Phase 10: Citation checker `--check` and CI wiring

Three mechanical assertions, exactly three (OQ-001 deferred). Assertion 2 is the one that closes D13:
a resolver keyed only on `ADR-\d+` **passes** the phantom citation at `ship-orchestrator.ts:492`,
because `ADR-007` resolves. Only an intra-record address — the `## Amendments` registry landed in
Phase 8 — catches it. Assertion 1 follows AMBER-1's scan rule. VR-007 requires observing the checker
**fail** as well as pass, which TR-006 does on a fixture tree.

**Files (5):**
- `src/engine/adr-check.ts` — **create** — citation scan with the AMBER-1 rule and ignore list; three assertions; one finding per line with `file:line` (FR-024)
- `src/engine/adr-check.test.ts` — **create** — fixture tree: unregistered `028 correction` exits 1 naming `file:line`, exits 0 once registered; unresolvable `ADR-099`; index-hash mismatch (TR-006)
- `src/commands/adr.ts` — **amend** — `--check` with `--format json` support; error-as-navigation messages (FR-024)
- `src/engine/ship-orchestrator.ts` — **amend** — correct the `ADR-007 + 028 correction` citation at `:492` to the registered amendment address (FR-025)
- `.github/workflows/ci.yml` — **amend** — run `node dist/cli.js define adr --check` after Build, before Test

**Requirements Addressed:** FR-024, FR-025 · US-010 · TC-005 · SC-007 · VR-007

**Dependencies:** Phase 1 (the `028 correction` block), Phase 8 (the registry that makes it resolvable), Phase 9 (ADR-010 exists).

**Contract Mapping:** `contracts/adr-engine.md` → `checkCitations`, `scanSurface`, `SCAN_IGNORE` → `src/engine/adr-check.ts`; `contracts/adr-command.md` → `--check` → `src/commands/adr.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| TC-005 document, not requirement | A citation resolver over `docs/decisions/`, **not** a coupling to the plan graph. No requirement semantics added |
| TC-006 no `drift-detector` change | `getDriftArtifacts()` is referenced only by its own test; adding `"docs/decisions"` is a no-op and MUST NOT be done |
| AMBER-1 scan rule | Bare ids in `src/`; addressed citations only in `docs/`/`specs/`; documented ignore list; angle-bracket templates skipped |
| ADR-004 error-as-navigation | Every finding names the offending `file:line` and, where one exists, the corrective command |
| VR-007 both directions | The checker MUST be observed failing on an unregistered fixture, not only passing |
| VR-004 MPL header | Required by hand on `adr-check.ts` |
| compile-gate | Always |

#### Test Strategy
| TR-### | Type | Target | Assertion |
|---|---|---|---|
| TR-006 | unit | `src/engine/adr-check.test.ts` | A `028 correction` citation with no registered amendment exits 1 and names the citing `file:line`; exits 0 once registered; an `ADR-099` citation with no file in `docs/decisions/` exits 1; an index-hash mismatch exits 1; the ignore list excludes `docs/archive/` and `.claude/`; a bare prose `ADR-030` is not reported; `ADR-010-<slug>.md` is skipped as a template |
| — | gate | built CLI | `define adr --check` exits 0 on the repaired tree |
| — | gate | `src/engine/ship-orchestrator.review-finding-liveness.test.ts` | Regression: 028's suite stays green after the `:492` comment correction |

#### Done When
```bash
pnpm run build
npx vitest run src/engine/adr-check.test.ts
node dist/cli.js define adr --check
grep -q '028 correction' docs/decisions/ADR-007-single-dispatch-path.md
grep -rq 'define adr --check' .github/workflows/
npx vitest run src/engine/ship-orchestrator.review-finding-liveness.test.ts
```

---

### Phase 11: Audit wiring and full-suite verification

`gwrk-constitution` already ships with a valid manifest and a well-formed `outputSchema` carrying
`required: [summary, intents]`, and is referenced from **no TypeScript today**. `--audit` reaches it with
three prompt changes: an appended `<decision_context>` block naming `docs/decisions/` and the index path
(mirroring how `research.ts:114` appends `<research_context>`, because the prompt currently tells the
agent nothing about where to write); the `spec.md`-invariant line at `:19` narrowed, since it is scope
creep for an ADR audit and duplicates `define analyze`; and reading the index rather than readdir-ing the
corpus, so the audit and the injected payload agree. `gwrk-analyze/PROMPT.md` gains a **seventh**
detection pass — passes A–F exist today and the string "ADR" appears zero times in its 215 lines.
Semantic contradiction is judgment, so it reports rather than gates.

**Files (4):**
- `src/commands/adr.ts` — **amend** — `--audit` dispatches `gwrk-constitution` through `WorkflowRuntime` with an appended `<decision_context>` block (FR-027)
- `src/commands/adr-dispatch.test.ts` — **amend** — `--audit` dispatches `gwrk-constitution` with the `<decision_context>` block naming the corpus and the index (TR-004)
- `src/plugins/builtins/workflows/gwrk-constitution/PROMPT.md` — **amend** — narrow the `spec.md`-invariant line at `:19`; read `.gwrk/decisions/index.md` rather than readdir the corpus
- `src/plugins/builtins/workflows/gwrk-analyze/PROMPT.md` — **amend** — seventh detection pass `#### G. Recorded Decision Contradiction`, reading `.gwrk/decisions/index.md` (FR-028)

**Requirements Addressed:** FR-027, FR-028 · US-012 · SC-010 · VR-003

**Dependencies:** Phase 5 (the index the audit reads), Phase 3 (the `--run` dispatch path `--audit` reuses).

**Contract Mapping:** `contracts/adr-command.md` → `--audit` → `src/commands/adr.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-007 (single dispatch path) | `--audit` dispatches through `WorkflowRuntime`; no raw spawn |
| SC-010 one new workflow | `gwrk-adr-record` is the **only** workflow this feature adds; `gwrk-constitution` is wired, not created |
| TC-008 no placeholder substitution | `<decision_context>` is appended text, not an interpolated token |
| TC-012 builtins ship through the build | Both prompt edits require `pnpm run build` to reach `dist/` |
| VR-003 full-suite green | `pnpm test:ci` confirms no regression in `cli.option-collisions.test.ts` (nine entries), `cli.consistency.test.ts` or `drift-detector.test.ts` |
| compile-gate | Always |

#### Test Strategy
| TR-### | Type | Target | Assertion |
|---|---|---|---|
| TR-004 | unit | `src/commands/adr-dispatch.test.ts` | `--audit` calls `executeWorkflow("gwrk-constitution", …)` with an appended `<decision_context>` block naming `docs/decisions/` and the index path |
| TR-014 | gate | both prompts | Constitution prompt references the index and no longer carries the `spec.md`-invariant line; analyze prompt references the index and mentions `ADR` |
| — | gate | `pnpm test:ci` | Full hermetic suite green; collision baseline still nine (TR-015), `cli.consistency.test.ts` untouched (TR-016), `drift-detector.test.ts` untouched (TR-017) |

#### Done When
```bash
pnpm run build
npx vitest run src/commands/adr-dispatch.test.ts
grep -q '.gwrk/decisions/index.md' src/plugins/builtins/workflows/gwrk-constitution/PROMPT.md
if grep -q 'invariants from .spec.md. files match implementation' src/plugins/builtins/workflows/gwrk-constitution/PROMPT.md; then exit 1; fi
grep -q '.gwrk/decisions/index.md' src/plugins/builtins/workflows/gwrk-analyze/PROMPT.md
grep -q 'ADR' src/plugins/builtins/workflows/gwrk-analyze/PROMPT.md
node dist/cli.js define adr --check
node dist/cli.js define adr --reindex --check
pnpm test:ci
```

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| `AdrRecord` | `src/engine/adr-parser.ts` | `adr-index.ts`, `adr-amend.ts`, `adr-check.ts`, `commands/adr.ts` |
| `AdrHeader` | `src/engine/adr-parser.ts` | `adr-index.ts` (row projection incl. `constraint`, `scope`, `status`, `supersedes`) |
| `AdrHeading` | `src/engine/adr-parser.ts` | `adr-amend.ts` (`--at` resolution), `adr-check.ts` (registry lookup) |
| `AdrScaffoldResult` | `src/engine/adr-scaffold.ts` | `commands/adr.ts` |
| `AdrIndex`, `AdrIndexRow` | `src/engine/adr-index.ts` | `adr-check.ts` (hash assertion), `commands/adr.ts` |
| `AdrIndexCheck` | `src/engine/adr-index.ts` | `commands/adr.ts` (`--reindex --check` exit code) |
| `AmendResult` | `src/engine/adr-amend.ts` | `commands/adr.ts` (emits the full-file `WRITE_FILE`) |
| `AdrCheckFinding` | `src/engine/adr-check.ts` | `commands/adr.ts` (`--check`, `--format json`) |
| `material.decisions` (additive field) | `src/engine/source-scanner.ts` | `src/commands/define-ontology.ts` |

No exported signature changes outside these modules. `groundingFiles` (FR-013) is a local
`Array<{path, tag}>` inside `dispatchToAgent`, not an exported type — a fourth entry changes no
signature. **No Zod schema is modified anywhere in this feature**; FR-019 reads the already-declared
`project.architecture.decisions` field at `config.ts:86-95`.

---

## Mockup-to-Selector Mapping

_No mockups exist for this feature._ The surface is a CLI command plus two generated artifacts
(`.gwrk/decisions/index.md`, `docs/decisions/ADR-NNN-*.md`).

---

## Deferred Items

| Spec Item | Title | Reason | Target |
|---|---|---|---|
| TR-015 | No `cli.option-collisions.test.ts` change | Spec-declared no-op. Per FR-008 and TC-013 `define adr` declares neither colliding flag, so the nine-entry baseline holds and both assertions pass untouched | Asserted as a regression gate in Phase 2 |
| TR-016 | No `cli.consistency.test.ts` change | Spec-declared no-op. Its feature-argument list is ten hardcoded command paths; the `define adr` positional is a title or an `ADR-NNN` id, not a feature | Regression only (Phase 11 `pnpm test:ci`) |
| TR-017 | No `drift-detector.test.ts` change | Spec-declared no-op per TC-006 — `getDriftArtifacts()` is referenced only by its own test; `plan verify` calls `verify()`, which never reads it | Regression only (Phase 11 `pnpm test:ci`) |
| OQ-001 | Fourth `--check` assertion for `ADR-NNN §X.Y` addresses | Would immediately fail on seven existing `ADR-007 §78` citations (correctly `§2.1`) across `specs/028-review-finding-liveness/spec.md` `:12,:91,:345,:421`, its `checklists/requirements.md` `:30,:73`, and `docs/code-review-verdict-defect.md` `:182,:225,:419`. Needs the corrections to land in the same change | Post-029 follow-up: correct the seven citations, then add the assertion |
| OQ-004 | `specs/000-build-plan.md` §Dependency Graph stops at `019` | Pre-existing drift, not caused here; verified that 023–029 are absent from the graph. FR-016 touches only the plan's header | Filed, not fixed |
| OQ-005 | `.gwrk/rules/*.md` read by no live code path | Carrier 4 of §1.2 with authority "None". `operating-model.md` and `workspace.md` are cited as prose from `.gwrk/agent-context.md:4` and `gwrk-plan/PROMPT.md:145-146` | Worth a decision of its own — out of scope here |
| Slack surface | `define adr` unreachable from Slack | §1.16 out of scope. `validSubs` is hardcoded in four places and `resolveFeature` throws without a `specs/` directory; `define research` and `define ontology` are already unreachable for the same two reasons | Slack-surface initiative, where one fix covers `research`, `ontology` and `adr` together |
| Section-anchor retrofit | All nine records | §1.9 out of scope — 117,866 bytes across files of 171–401 lines, for a scheme whose only current consumers are prose citations. Retrofit is bounded to ADR-005 and ADR-007 (FR-022) | Phase 8 covers the bounded two |
| `gwrk-plan/PROMPT.md:145`, `:148` | `seeding-governance.md`, `specify-sharpen` dead pointers | Unrelated to decisions. Only `:147` (`decision-forge`) is in scope, via FR-016 | Filed, not fixed |
| D3 (`specify.ts:125-127`) | `--number` cannot choose a spec number | Moot for this spec — `specs/028-…` and `specs/029-…` already exist at the right numbers, so the ordering hazard did not fire. Remains unfixed and will bite the next feature | Filed (OQ-006) |

---

## Coverage Matrix

### User Stories

| Spec Item | Phase | Status |
|---|---|---|
| US-001 | 2, 9 | Planned |
| US-002 | 1 | Planned |
| US-003 | 3 | Planned |
| US-004 | 6 | Planned |
| US-005 | 4, 5 | Planned |
| US-006 | 5 | Planned |
| US-007 | 6, 7 | Planned |
| US-008 | 5, 6 | Planned |
| US-009 | 8 | Planned |
| US-010 | 1, 10 | Planned |
| US-011 | 8 | Planned |
| US-012 | 11 | Planned |

### Functional Requirements

| Spec Item | Phase | Status |
|---|---|---|
| FR-001 | 2 | Planned |
| FR-002 | 2 | Planned |
| FR-003 | 2 | Planned (local calendar date per AMBER-5) |
| FR-004 | 1 | Planned |
| FR-005 | 1 | Planned |
| FR-006 | 1 | Planned |
| FR-007 | 3 | Planned |
| FR-008 | 2 | Planned |
| FR-009 | 5 | Planned |
| FR-010 | 4 | Planned |
| FR-011 | 5 | Planned |
| FR-012 | 5 | Planned |
| FR-013 | 6 | Planned |
| FR-014 | 5 | Planned |
| FR-015 | 6 | Planned |
| FR-016 | 7 | Planned |
| FR-017 | 6 | Planned |
| FR-018 | 7 | Planned |
| FR-019 | 2 | Planned (spec lists it under the Phase 2 heading; TR-001 and US-001 place it with the scaffolder) |
| FR-020 | 8 | Planned |
| FR-021 | 8 | Planned |
| FR-022 | 8 | Planned (heading form per AMBER-2) |
| FR-023 | 8 | Planned |
| FR-024 | 10 | Planned (scan rule per AMBER-1) |
| FR-025 | 10 | Planned |
| FR-026 | 5, 8 | Planned |
| FR-027 | 11 | Planned |
| FR-028 | 11 | Planned |

### Testing Requirements

| Spec Item | Phase | Status |
|---|---|---|
| TR-001 | 2 | Planned |
| TR-002 | 1 | Planned |
| TR-003 | 2, 8 | Planned |
| TR-004 | 3, 11 | Planned |
| TR-005 | 5, 9 | Planned |
| TR-006 | 10 | Planned |
| TR-007 | 8 | Planned |
| TR-008 | 6 | Planned |
| TR-009 | 2 | Planned |
| TR-010 | 2 | Planned |
| TR-011 | 6 | Planned |
| TR-012 | 7 | Planned |
| TR-013 | 6 | Planned |
| TR-014 | 1, 3, 4, 7, 8, 9, 10, 11 | Planned (shell-grep invariants, split by the phase that lands each edit) |
| TR-015 | — | Deferred — spec-declared no-op (TC-013); regression-gated in Phase 2 |
| TR-016 | — | Deferred — spec-declared no-op; regression-gated in Phase 11 |
| TR-017 | — | Deferred — spec-declared no-op (TC-006); regression-gated in Phase 11 |

### Technical Constraints

| Spec Item | Phase | Status |
|---|---|---|
| TC-001 air-gapped | All | Honoured — no network call introduced |
| TC-002 fail-fast config | 2 | Honoured — `loadConfig`, no `.default()`; invalid config rejects (AMBER-4) |
| TC-003 TypeScript only | All | Honoured — every new module is `.ts`, ESM |
| TC-004 no fifth carrier | 5, 6, 7 | Honoured — index derived; one pointer line in `.gwrk/agent-context.md` |
| TC-005 document, not requirement | 10 | Honoured — citation resolver only, no plan-graph coupling |
| TC-006 no `drift-detector` change | — | Honoured by omission; regression-gated in Phase 11 |
| TC-007 blockquote, not YAML | 1, 2, 4 | Honoured — house `> **Field:**` form |
| TC-008 no placeholder substitution | 3, 7, 11 | Honoured — file read or appended tag |
| TC-009 uniform injection | 6 | Honoured — no scope or stage filter |
| TC-010 injection budget | 4, 5 | Honoured — one-sentence cap; measured in Phase 5 (VR-008) |
| TC-011 nothing named "cascade" | 3 | Honoured — `gwrk-adr-record`; `gwrk-cascade-sync` untouched |
| TC-012 builtins ship through the build | 3, 7, 11 | Honoured — `pnpm run build` precedes every `dist/` assertion |
| TC-013 no option collisions | 2 | Honoured — no `--refs`, no `--dry-run`, no allowlist entry |
| TC-014 bare-clone operable | 1, 2, 5, 8, 10 | Honoured — no SQLite, no build server; scoped to an absent config (AMBER-4) |
| TC-015 no lock manager | 2 | Departure recorded as AMBER-3 — atomic claim released on exit; no lock manager, daemon, timeout or retry loop |
| TC-016 fail-open grounding | 6 | Honoured — inherited verbatim from the three existing rows |

### Data Model, Roles, Success and Verification

| Spec Item | Phase | Status |
|---|---|---|
| DM-000 no database entities | — | Honoured — no `data-model.md`, no migration, no Zod change |
| DM-001 no spine node | 5 | Honoured — no table, no `plan_features` row, no `tasks.json` entry |
| DM-002 hash over parsed headers | 5 | Planned |
| RP-000 shared RBAC | — | Honoured — no feature-specific roles |
| RP-001 `--decide` ships no guard | 8 | Honoured — diff + PR is the human gate |
| SC-001 | 2 | Planned |
| SC-002 | 1 | Planned |
| SC-003 | 9 | Planned |
| SC-004 | 6 | Planned |
| SC-005 | 4, 5 | Planned |
| SC-006 | 5 | Planned |
| SC-007 | 10 | Planned |
| SC-008 | 5 | Planned |
| SC-009 | 7 | Planned |
| SC-010 | 3, 11 | Planned |
| SC-011 | 5 | Planned |
| SC-012 | 3 | Planned — Phase 1–3 gates pass with no index, no grounding change, no prompt change |
| VR-001 build before any `dist/` assertion | 1–11 | Every Done-When block opens with `pnpm run build` where it asserts on `dist/` or the built CLI |
| VR-002 named suites exit 0 | 1–11 | Distributed across phase gates; the union is the VR-002 command line |
| VR-003 `pnpm test:ci` exits 0 | 11 | Final gate |
| VR-004 MPL header on every new `.ts` | 1, 2, 3, 5, 6, 8, 10 | Named in each phase's Governance contract — the pre-commit hook is absent in this clone |
| VR-005 new suites run locally | 1–11 | `tsconfig.json:15` excludes `**/*.test.ts` and biome ignores most test globs, so neither gate would surface an error in them |
| VR-006 phase-independent verification | 3 | Phase 1–3 gates assert `test ! -f .gwrk/decisions/index.md` |
| VR-007 `--check` observed failing and passing | 10 | TR-006 asserts exit 1 on the unregistered fixture; the phase gate asserts exit 0 on the repaired tree |
| VR-008 payload size measured | 5 | TR-005 token-budget assertion, not an estimate |
| VR-009 not verified by `gwrk ship` or the daemon | All | Human-only delivery; Phase 6 changes the payload the review dispatches would themselves receive |
| VR-010 gate in `task.gateScript` | All | Satisfied structurally — fenced-bash Done-When → `plan-to-tasks.ts:337-339` copies it onto every task |

**Zero unaccounted items.** Twelve user stories, twenty-eight functional requirements, seventeen
testing requirements (three spec-declared no-ops), sixteen technical constraints, three data-model
notes, two role notes, twelve success criteria and ten verification requirements are each assigned to
a phase or listed in Deferred Items with rationale.

---

## Cross-Reference Notes

- **028-review-finding-liveness (bidirectional).** 028's FR-011 (W4) is outstanding and requires ADR-007
  to carry the inline `028 correction` block. Plan Phase 1 lands exactly that edit, using the markdown
  already written at `docs/code-review-verdict-defect.md:422-431`. **Landing Phase 1 closes 028 FR-011.**
  To avoid double-authoring: 029 gates the block with a shell grep (TR-014, Phase 1); the vitest case in
  `src/engine/ship-orchestrator.review-finding-liveness.test.ts` stays 028's deliverable (its TR-011).
  Phase 10 runs that suite as a regression gate after correcting the `:492` comment.
- **023-plan-format-contract.** Phase 7 changes `plan-renderer.ts`'s **header** only. Verified that the
  023 parser fix is present on this tree (`plan-to-tasks.ts:337-339`), which is what makes VR-010
  satisfiable by a fenced Done-When block.
- **No `contracts/` directory exists in any sibling spec** (`ls specs/*/contracts/*.md` is empty), so
  there is no contract-type conflict to resolve. 014's and 018's plans reference `contracts/…` paths
  that were never created.
- **Shared source overlap checked.** `plan-renderer.ts` is claimed by 018's plan (`:140`) and
  `source-scanner.ts` by 014's plan (`:225`) — both as original creators, both already shipped. No
  competing in-flight edit. `agent.ts`'s `groundingFiles` array is referenced by no other spec.
- **000-build-plan** adds no graph node for this feature; the graph's staleness at `019` is pre-existing
  (OQ-004).

## Process Notes

- **Branch.** The command's branch discipline puts definitional work on `develop`, but
  `git ls-tree develop -- specs/029-decision-records/` is empty — the spec exists only on
  `feat/decision-records` (`5017df1`, `7cf6591`). Switching would make the spec unreadable and orphan
  this plan, so the plan is authored on `feat/decision-records`. Per gwrk workflow constraints the PR
  targets `develop`.
- **Prerequisites.** `.specify/scripts/bash/check-prerequisites.sh` no longer exists; the `.specify`
  tree is archived at `docs/archive/specify/`. Prerequisites were verified directly: `spec.md` present,
  no pre-existing `plan.md`, no sibling `contracts/`.
- **Delivery.** By hand with TDD, per VR-009 — not through `gwrk ship` or the daemon.
