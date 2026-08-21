# Feature Specification: 029 Decision Records

**Feature Directory**: `specs/029-decision-records/`
**Created**: 2026-08-20
**Status**: Draft
**Lineage**: 026 gate-runner convergence → 027 gate liveness → 028 review-finding liveness → **029 decision records**
**Input**: Make architecture decision records a first-class gwrk artifact. `gwrk define adr` scaffolds a numbered record and drafts it via a builtin workflow; a generated index reaches every agent dispatch; amend, supersede and ratify are modelled operations; the nine existing ADRs parse unchanged.
**Authoritative source**: [`docs/research/R012-adr-first-class/draft.md`](../../docs/research/R012-adr-first-class/draft.md) — "R012: ADRs as a gwrk artifact". Every design choice (§1.1–§1.17), phase boundary (§2), file (§3), template clause (§4.1), migration edit (§4.2), test-surface entry (§5) and defect ID (`D1`–`D13`, §6) below is drawn from that document and re-verified against `develop` at `cee5ada`.

---

## 1. Overview

`docs/decisions/` holds nine ADRs that no gwrk command writes, reads correctly, or checks. The corpus is doctrine with no machinery:

- **Nothing authors one.** There is no `gwrk define adr`. ADR-010 does not exist because writing a record is a manual act nobody sequenced.
- **One reader, and it mislabels them.** [`source-scanner.ts:57-69`](../../src/engine/source-scanner.ts) readdirs `docs/decisions/` and pushes every file into `material.patterns`, which [`define-ontology.ts:48-49`](../../src/commands/define-ontology.ts) renders under `## Code Patterns`. Nine architecture decisions arrive at the ontology workflow labelled as code patterns.
- **No dispatch sees them.** The grounding loop at [`agent.ts:567-581`](../../src/utils/agent.ts) injects three tags — `domain_ontology`, `information_hierarchy`, `ux_posture`. Decisions are not among them, and `.gwrk/perspective/` does not exist, so today's real payload is `domain.md` alone.
- **The citations rot in place.** Three hardcoded ADR lists ([`plan-renderer.ts:38`](../../src/engine/plan-renderer.ts), [`gwrk-plan/PROMPT.md:60-65`](../../src/plugins/builtins/workflows/gwrk-plan/PROMPT.md), [`docs/grounding/architecture.md:4,:19-24`](../../docs/grounding/architecture.md)) stop at ADR-004 or ADR-006 and carry dead `file:///Users/gonzo/…` links. `gwrk-plan/PROMPT.md:147` routes "Architecture decisions" to `~/.gwrk/plugins/skills/decision-forge/SKILL.md`, a skill that does not exist.
- **Nothing resolves a citation.** [`ship-orchestrator.ts:492`](../../src/engine/ship-orchestrator.ts) cites `ADR-007 + 028 correction`. ADR-007 carries no such block. Nothing detected it.

### The motivating defect (D13)

The phantom `028 correction` is the defect this feature exists to close, and it is instructive that the obvious fix would have missed it. A resolver keyed on `ADR-\d+` **passes** the citation: `ADR-007` resolves, because [`ADR-007-single-dispatch-path.md`](../../docs/decisions/ADR-007-single-dispatch-path.md) exists. Only an *intra-record* address — the amendment registry of §1.9 — catches it. That re-ranks the work: the first precondition does not pay back the defect; Phase 3 does.

### Corrections this spec carries forward (source §0)

Five survey findings that change a requirement, each verified here:

| # | Finding | Consequence for this spec |
|---|---|---|
| §0.1 | `parser.ts:215` tokenizes `ADR-\d+`, but `extractPhaseRequirements` has **zero call sites** — `tests-generate.ts:17` imports and never invokes it. Nothing in the repo resolves a requirement id of any class, `FR-` included | An ADR is a **document** carrying a requirement-class id (TC-005). No requirement semantics are added |
| §0.2 | The requirement/document fork would not have caught the phantom `028 correction` | FR-024 assertion 2, not FR-024 assertion 1, closes D13 |
| §0.3 | `getDriftArtifacts()` ([`drift-detector.ts:124-126`](../../src/engine/drift-detector.ts)) has one reference outside its definition — its own test. `plan verify` calls `verify()`, which never reads it | **No change to `drift-detector`** (TC-006). Adding `"docs/decisions"` is a no-op |
| §0.4 | `.gwrk/ontology/domain.md` and `.gwrk/agent-context.md` are both git-tracked; only `.gwrk/server.pid` and `.gwrk/dispatches.jsonl` are ignored | Worktree survival does not distinguish the two carrier candidates. FR-013 is chosen on freshness and ownership, not survival |
| §0.5 | `gwrk-cascade-sync` is a second unwired builtin — a **code** cascade (`pnpm build`, `pnpm test`), not a definitional one | TC-011: nothing in this feature may be named "cascade" |

### Carrier ranking (source §1.2)

| Rank | Carrier | Authority | State |
|---|---|---|---|
| 1 | `docs/decisions/*.md` | Doctrine | Nine files. One reader, mislabelling them |
| 2 | `~/.gwrk/plugins/skills/*/SKILL.md` | Enforcement | Live, scope- and profile-filtered ([`skill-runtime.ts:167`](../../src/plugins/skill-runtime.ts)). Global, not per-project |
| 3 | `.gwrk/agent-context.md` → `CLAUDE.md`/`AGENTS.md`/`GEMINI.md` | Standing instruction | Live splice. Six lines today. Manual trigger only |
| 4 | `.gwrk/rules/*.md` | None | `operating-model.md`, `workspace.md` on disk. Read by no live code path |

`docs/decisions/` stays the single source of truth. **No fifth carrier** (TC-004). The index is a derived projection of carrier 1, delivered through the grounding channel, with one pointer line added to carrier 3.

### Delivery shape

Four phases, ordered so Phase 1 ships alone and Phase 3 pays back D13.

| Phase | Scope | Value if it ships alone |
|---|---|---|
| **1 — Author** | `gwrk define adr`, scaffolder, parser, template, corpus reconciliation edits 1–5, `gwrk-adr-record` builtin | The corpus stops drifting in shape and the next decision gets written instead of remembered |
| **2 — Index and inject** | `adr-index`, `.gwrk/decisions/index.md`, `--reindex`, fourth grounding row, `Constraint:` field, three stale lists, scanner field split | Every dispatch learns what it may not do |
| **3 — Amend and check** | `--amend --at`, `--append-section`, `--decide`, `## Amendments` registry, `--check` in CI | Closes D13 |
| **4 — Audit** | `gwrk-constitution` behind `--audit`, seventh `gwrk-analyze` pass | Semantic contradiction gets reported |

### Out of scope

- **Slack** (§1.16). `validSubs = ["spec","plan","tasks","tests"]` is hardcoded in four places ([`slack-commands.ts:686`,`:695`,`:778`](../../src/server/slack-commands.ts), [`slack-mentions.ts:135`](../../src/server/slack-mentions.ts)), and `resolveFeature` at `:710` throws without a `specs/` directory before the spawn at `:713`. `define research` and `define ontology` are already unreachable there for the same two reasons. Ratification needs a diff and a PR review, for which Slack has no channel. The four-copy duplication is filed for a Slack-surface initiative where one fix covers `research`, `ontology` and `adr` together.
- **`drift-detector`** (§0.3) — a no-op. See TC-006.
- **ADR-as-requirement semantics** (§1.1) — would give decisions stronger verification than `FR-` ids have. See TC-005.
- **A `plan_proposals`-style approval table** (§1.11) — dead code (`insertProposal` writes an `updated_at` column the table lacks), hard-bound to `target_phase_id NOT NULL`, and a spine node is forbidden by TC-007.
- **Retrofitting section anchors to all nine records** (§1.9) — 117,866 bytes across files of 171 to 401 lines, for a scheme whose only current consumers are prose citations. Retrofit is bounded to ADR-005 and ADR-007 (FR-022).
- **YAML frontmatter** (§1.3) — forks the house blockquote convention and orphans the parser from `plan-renderer` and `architecture.md`. See TC-003.
- **Per-stage injection gating** (§1.12) — a definition-only gate would exclude IMPLEMENT and review, the two stages with the highest demand and zero decision references today.
- Repairing `gwrk-plan/PROMPT.md:145` (`.gwrk/rules/seeding-governance.md`) and `:148` (`specify-sharpen`) — dead pointers unrelated to decisions. Filed, not fixed. Only `:147` is in scope (FR-016).

---

## 2. User Scenarios & Testing

### US-001 - An engineer records a decision without choosing its number (Priority: P0)
As an engineer who has just settled an architectural question, I run `gwrk define adr "<title>"` and get `docs/decisions/ADR-010-<slug>.md` containing the template of §4.1 with `Status: Proposed` and today's date — allocated max+1 over the existing corpus, from any subdirectory of the project, and refusing loudly rather than writing a sibling if that number is already taken.

**Implements**: FR-001, FR-002, FR-003, FR-008, FR-019

**Independent Test**: With `node:fs/promises` mocked, drive the scaffolder against a fixture corpus of `ADR-001-…` through `ADR-009-…` and assert `writeFile` receives a path ending `ADR-010-` plus the slug; assert the written body matches the §4.1 template with `Status: Proposed`. Re-drive with `ADR-010-other-slug.md` present and assert the call rejects, naming the conflicting path, without calling `writeFile`.

**Acceptance Scenarios**:
1. **Given** a corpus of ADR-001 through ADR-009, **When** `gwrk define adr "Decision Records"` runs, **Then**:
   - `npx vitest run src/engine/adr-scaffold.test.ts -t "FR-002: allocates max+1 over the existing corpus"` exits 0
   - `npx vitest run src/engine/adr-scaffold.test.ts -t "FR-003: writes the section-numbered template with Status Proposed"` exits 0
2. **Given** `ADR-010-something-else.md` already on disk, **When** the same command runs, **Then**:
   - `npx vitest run src/engine/adr-scaffold.test.ts -t "FR-002: fails loudly on a same-number different-slug collision"` exits 0
   - `npx vitest run src/engine/adr-scaffold.test.ts -t "FR-002: does not write when the number is taken"` exits 0
3. **Given** the working directory is a subdirectory of the project, **When** the command runs, **Then**:
   - `npx vitest run src/engine/adr-scaffold.test.ts -t "FR-002: discovers the project root by walking parents for .gwrkrc.json"` exits 0
4. **Given** a readdir result containing directories and non-markdown files, **When** the allocator filters, **Then**:
   - `npx vitest run src/engine/adr-scaffold.test.ts -t "FR-002: filters on the .md suffix and the ADR-NNN pattern"` exits 0
5. **Given** the shipped CLI, **When** `define --help` is inspected, **Then**:
   - `npx vitest run src/cli.e2e.test.ts -t "US-018"` exits 0
   - `node dist/index.js define --help | grep -qE '^\s+adr\b'` exits 0
   - `node dist/index.js define adr --help | grep -q 'Examples:'` exits 0

### US-002 - The nine existing records parse unchanged (Priority: P0)
As the `adr-parser`, I read every one of the nine records on disk and return its status, decision, dependencies and supersession relations plus its heading tree, tolerating the four documented header inconsistencies — because a parser that only reads records it wrote is a parser with nine blind spots.

**Implements**: FR-004, FR-005, FR-006

**Independent Test**: Run the parser against fixtures reproducing each documented inconsistency — `# ADR: <title>` with the number only in the filename (001, 002), trailing double-space hard breaks (001), a missing `Supersedes` and `Depends on` (001), and `·` separating two fields on one line — and assert a populated result for each. Assert the fixtures, not `docs/decisions/`, are the input.

**Acceptance Scenarios**:
1. **Given** a fixture using `# ADR: <title>` with no number in the H1, **When** the parser runs, **Then**:
   - `npx vitest run src/engine/adr-parser.test.ts -t "FR-004: recovers the number from the filename when the H1 omits it"` exits 0
2. **Given** a fixture with trailing double-space hard breaks, **When** the parser runs, **Then**:
   - `npx vitest run src/engine/adr-parser.test.ts -t "FR-004: tolerates trailing double-space hard breaks"` exits 0
3. **Given** a fixture with neither `Supersedes` nor `Depends on`, **When** the parser runs, **Then**:
   - `npx vitest run src/engine/adr-parser.test.ts -t "FR-004: returns empty relations rather than throwing"` exits 0
4. **Given** a fixture with `> **Status:** Decided · **Date:** 2026-02-26`, **When** the parser runs, **Then**:
   - `npx vitest run src/engine/adr-parser.test.ts -t "FR-004: splits two fields separated by the middle dot"` exits 0
5. **Given** a fixture with a 240-character `Decision:` value, **When** the parser runs, **Then**:
   - `npx vitest run src/engine/adr-parser.test.ts -t "FR-004: preserves a 240-character Decision value"` exits 0
6. **Given** the reconciled corpus, **When** each record's H1 is inspected, **Then**:
   - `for f in docs/decisions/ADR-00*.md; do head -1 "$f" | grep -qE '^# ADR-00[1-9]: '; done` exits 0
   - `! grep -rq 'file:///Users/gonzo' docs/decisions/` exits 0
   - `test "$(grep -c '^## 7\.' docs/decisions/ADR-001-task-tracking.md)" = 1` exits 0
7. **Given** the reconciled corpus, **When** statuses are inspected, **Then**:
   - `! grep -q 'Status:\*\* Proposed' docs/decisions/ADR-006-plugin-agent-backends.md` exits 0
   - `! grep -q 'Status:\*\* Proposed' docs/decisions/ADR-007-single-dispatch-path.md` exits 0
8. **Given** the parser reads the live corpus in a smoke check, **When** all nine are parsed, **Then**:
   - `npx vitest run src/engine/adr-parser.test.ts -t "FR-004: uses fixtures, never the live corpus"` exits 0

### US-003 - A scaffolded record can be drafted by an agent (Priority: P1)
As an engineer who wants the record written rather than templated, I add `--run` and the command dispatches the `gwrk-adr-record` builtin workflow through `WorkflowRuntime` with the title and the target path, receiving `{summary, intents}` back — and without `--run` no runtime is ever constructed.

**Implements**: FR-007, FR-008

**Independent Test**: Per `research-dispatch.test.ts`: mock `WorkflowRuntime`, `node:fs/promises`, `loadConfig` and `resolveModelForTask`. Assert `executeWorkflow` receives `gwrk-adr-record`, an input containing the title, an options object carrying `{agent, model}`, and `projectRoot`. Re-drive without `--run` and assert the `WorkflowRuntime` constructor is never called.

**Acceptance Scenarios**:
1. **Given** `--run`, **When** the handler executes, **Then**:
   - `npx vitest run src/commands/adr-dispatch.test.ts -t "FR-007: dispatches gwrk-adr-record through WorkflowRuntime"` exits 0
   - `npx vitest run src/commands/adr-dispatch.test.ts -t "FR-007: passes the title in the workflow input"` exits 0
   - `npx vitest run src/commands/adr-dispatch.test.ts -t "FR-007: passes projectRoot so project-local overrides resolve"` exits 0
2. **Given** no `--run`, **When** the handler executes, **Then**:
   - `npx vitest run src/commands/adr-dispatch.test.ts -t "FR-007: never constructs the runtime without --run"` exits 0
3. **Given** the builtin ships in `dist/`, **When** the tree is inspected after `npm run build`, **Then**:
   - `test -f dist/plugins/builtins/workflows/gwrk-adr-record/manifest.yaml` exits 0
   - `test -f dist/plugins/builtins/workflows/gwrk-adr-record/PROMPT.md` exits 0
   - `grep -q 'required: \[summary, intents\]' src/plugins/builtins/workflows/gwrk-adr-record/manifest.yaml` exits 0
4. **Given** the shipped prompt, **When** it is scanned for substitution tokens, **Then**:
   - `! grep -qE '\{\{[A-Z_]+\}\}' src/plugins/builtins/workflows/gwrk-adr-record/PROMPT.md` exits 0

### US-004 - Every dispatch learns what it may not do (Priority: P0)
As any agent dispatched through `dispatchToAgent` — IMPLEMENT included, which needs decisions most and receives none today — I receive an `<architecture_decisions>` block read fresh from `.gwrk/decisions/index.md`, uniformly, with no trigger to remember and no per-stage gate.

**Implements**: FR-009, FR-011, FR-013

**Independent Test**: Drive `dispatchToAgent`'s prompt assembly with `.gwrk/decisions/index.md` present and assert the stdin payload contains `<architecture_decisions>` wrapping the file's content; remove the file and assert the tag is absent, no warning is printed, and dispatch proceeds. Assert the grounding array carries exactly four entries and no scope parameter.

**Acceptance Scenarios**:
1. **Given** `.gwrk/decisions/index.md` exists, **When** a task is dispatched, **Then**:
   - `npx vitest run src/utils/agent.grounding-decisions.test.ts -t "FR-013: injects architecture_decisions when the index exists"` exits 0
2. **Given** the index is absent, **When** a task is dispatched, **Then**:
   - `npx vitest run src/utils/agent.grounding-decisions.test.ts -t "FR-013: skips silently when the index is absent"` exits 0
   - `npx vitest run src/utils/agent.grounding-decisions.test.ts -t "FR-013: dispatch continues when the index is unreadable"` exits 0
3. **Given** the grounding loop, **When** its shape is inspected, **Then**:
   - `npx vitest run src/utils/agent.grounding-decisions.test.ts -t "FR-013: injects uniformly, with no stage or scope filter"` exits 0
   - `grep -q 'architecture_decisions' src/utils/agent.ts` exits 0

### US-005 - The index says what is forbidden, and hides nothing (Priority: P0)
As an implementer reading the index, I see one row per ADR — never filtered by status — carrying scope, status and a one-sentence imperative **Constraint**, because ADR-007's decision line ("All workflow dispatch flows through `WorkflowRuntime`") leaves me unable to tell that a `spawn("claude")` is forbidden.

**Implements**: FR-009, FR-010, FR-011

**Independent Test**: Generate the index from a nine-record fixture, two of them `Proposed`, and assert nine rows, the `| ADR | Scope | Status | Constraint |` header, and each row's `Constraint` cell lifted from that record's header field. Assert no row is omitted for status.

**Acceptance Scenarios**:
1. **Given** a nine-record fixture including two `Proposed`, **When** the index generates, **Then**:
   - `npx vitest run src/engine/adr-index.test.ts -t "FR-011: emits one row per record and never filters on status"` exits 0
   - `npx vitest run src/engine/adr-index.test.ts -t "FR-011: emits the ADR Scope Status Constraint header"` exits 0
2. **Given** each record carries a `Constraint:` header field, **When** the index generates, **Then**:
   - `npx vitest run src/engine/adr-index.test.ts -t "FR-010: projects the Constraint field into the row"` exits 0
   - `for f in docs/decisions/ADR-00*.md; do grep -q '^> \*\*Constraint:\*\*' "$f"; done` exits 0
3. **Given** the generated index, **When** its size is measured, **Then**:
   - `npx vitest run src/engine/adr-index.test.ts -t "FR-011: stays inside the 1000-token injection budget"` exits 0
4. **Given** the status vocabulary, **When** the corpus is inspected, **Then**:
   - `! grep -rqE '^> \*\*Status:\*\* (Accepted|Rejected|Deprecated)' docs/decisions/` exits 0

### US-006 - A partial supersession does not read as a retirement (Priority: P1)
As an agent reading ADR-001's row, I see `superseded in part by ADR-002 (storage mechanism only)` rather than a bare "superseded" — because ADR-001's Hard Gate Architecture is live and cited from ADR-005's own header, and a boolean would tell me to ignore it. The back-reference is derived from ADR-002's forward `Supersedes` field, so no corpus edit records it.

**Implements**: FR-012

**Independent Test**: Generate the index from fixtures where ADR-002 declares `Supersedes: ADR-001 (storage mechanism only)` and ADR-003 declares `Supersedes: Partial aspects of ADR-002 §3 (Learning Loop Extraction)`. Assert ADR-001's row carries the inverse edge with the qualifier verbatim, that no fixture records its own back-reference, and that the unqualified word "superseded" never appears alone in a row whose source qualifier was non-empty.

**Acceptance Scenarios**:
1. **Given** ADR-002 supersedes ADR-001 in part, **When** the index generates, **Then**:
   - `npx vitest run src/engine/adr-index.test.ts -t "FR-012: derives the back-reference onto the superseded row"` exits 0
   - `npx vitest run src/engine/adr-index.test.ts -t "FR-012: carries the qualifier verbatim"` exits 0
2. **Given** ADR-003's free-text supersession, **When** the index generates, **Then**:
   - `npx vitest run src/engine/adr-index.test.ts -t "FR-012: preserves a free-text partial supersession"` exits 0
3. **Given** only forward `Supersedes` fields exist, **When** the corpus is inspected, **Then**:
   - `! grep -rq 'Superseded by' docs/decisions/` exits 0

### US-007 - The stale ADR lists point at the index instead of enumerating (Priority: P1)
As a Senior Architect dispatched to plan, and as every generated build plan, I am pointed at one index rather than an enumeration that stopped at ADR-004 or ADR-006 and links through dead `file:///Users/gonzo/…` paths.

**Implements**: FR-015, FR-016, FR-018

**Independent Test**: Render a build plan header and assert one index link and no per-ADR enumeration. Grep the two prompts and `docs/grounding/architecture.md` for the enumeration, the dead link scheme, and the `decision-forge` route.

**Acceptance Scenarios**:
1. **Given** the plan renderer, **When** a build plan header is rendered, **Then**:
   - `npx vitest run src/engine/plan-renderer.test.ts -t "FR-016: links the decision index instead of enumerating ADRs"` exits 0
   - `! grep -q 'ADR-005-tdd-gate-architecture.md), \[ADR-006' src/engine/plan-renderer.ts` exits 0
2. **Given** the shipped prompts, **When** they are inspected, **Then**:
   - `grep -q '.gwrk/decisions/index.md' src/plugins/builtins/workflows/gwrk-plan/PROMPT.md` exits 0
   - `grep -q 'architecture_decisions' src/plugins/builtins/workflows/gwrk-plan/PROMPT.md` exits 0
   - `grep -q '.gwrk/decisions/index.md' src/plugins/builtins/workflows/gwrk-specify/PROMPT.md` exits 0
   - `! grep -q 'decision-forge' src/plugins/builtins/workflows/gwrk-plan/PROMPT.md` exits 0
3. **Given** `docs/grounding/architecture.md`, **When** its anchors are inspected, **Then**:
   - `! grep -q 'file:///Users/gonzo' docs/grounding/architecture.md` exits 0
   - `grep -q '.gwrk/decisions/index.md' docs/grounding/architecture.md` exits 0
4. **Given** the ontology grounding material, **When** it is assembled, **Then**:
   - `npx vitest run src/engine/source-scanner.test.ts -t "FR-015: puts decisions in material.decisions, not material.patterns"` exits 0
   - `npx vitest run src/commands/define-ontology.test.ts -t "FR-015: renders decisions under their own heading"` exits 0
5. **Given** `.gwrk/agent-context.md`, **When** it is inspected, **Then**:
   - `grep -q '.gwrk/decisions/index.md' .gwrk/agent-context.md` exits 0
   - `test "$(grep -c '.gwrk/decisions/index.md' .gwrk/agent-context.md)" = 1` exits 0

### US-008 - Index staleness is detectable, not assumed (Priority: P1)
As CI, I run `gwrk define adr --reindex --check` and get a non-zero exit when the index's content hash disagrees with the parsed corpus headers — so a hand-edited ADR that never triggered a regeneration is caught rather than silently injected stale.

**Implements**: FR-009, FR-014, FR-017

**Independent Test**: Generate an index, mutate one fixture header, and assert `--reindex --check` exits 1 naming the divergent record; assert an unmutated corpus exits 0. Assert the same hash is produced twice from identical input.

**Acceptance Scenarios**:
1. **Given** a corpus matching the index, **When** `--reindex --check` runs, **Then**:
   - `npx vitest run src/engine/adr-index.test.ts -t "FR-014: exits 0 when the hash matches the corpus"` exits 0
2. **Given** a header edited without a regeneration, **When** `--reindex --check` runs, **Then**:
   - `npx vitest run src/engine/adr-index.test.ts -t "FR-014: exits non-zero when the hash disagrees"` exits 0
3. **Given** identical corpus input, **When** the hash is computed twice, **Then**:
   - `npx vitest run src/engine/adr-index.test.ts -t "FR-009: produces a stable hash for identical input"` exits 0
4. **Given** `gwrk init` in a project with a non-empty `docs/decisions/`, **When** it completes, **Then**:
   - `npx vitest run src/commands/init.test.ts -t "FR-017: generates the decision index when docs/decisions is non-empty"` exits 0
   - `npx vitest run src/commands/init.test.ts -t "FR-017: writes no index when docs/decisions is empty"` exits 0

### US-009 - Amending a record is one command, not a remembered cascade (Priority: P1)
As an engineer applying a correction, I run `gwrk define adr ADR-007 --amend --at 2.1` or `--append-section`, and the command inserts at the address resolved through the parsed heading tree — never a line number — registers the amendment in `## Amendments`, and regenerates the index in the same invocation.

**Implements**: FR-020, FR-021, FR-022, FR-026

**Independent Test**: Drive `--amend --at 2.1` against an ADR-007 fixture and assert the insertion lands at the end of §2.1's body, that `## Amendments` gains a row keyed by the amending record's id, and that the index generator is called. Drive `--at 9.9` and assert a non-zero exit naming the unresolvable address. Assert the emitted intent is a full-file `WRITE_FILE` that grows the file.

**Acceptance Scenarios**:
1. **Given** an ADR-007 fixture, **When** `--amend --at 2.1` runs, **Then**:
   - `npx vitest run src/engine/adr-amend.test.ts -t "FR-020: inserts at the end of the addressed section body"` exits 0
   - `npx vitest run src/engine/adr-amend.test.ts -t "FR-020: resolves the address through the heading tree, not a line number"` exits 0
2. **Given** `--at 9.9`, **When** the command runs, **Then**:
   - `npx vitest run src/engine/adr-amend.test.ts -t "FR-020: fails on an unresolvable section address"` exits 0
3. **Given** `--append-section`, **When** the command runs, **Then**:
   - `npx vitest run src/engine/adr-amend.test.ts -t "FR-021: numbers the new section max+1 over existing ## N. headings"` exits 0
4. **Given** any amendment, **When** the intent is emitted, **Then**:
   - `npx vitest run src/engine/adr-amend.test.ts -t "FR-020: emits a full-file WRITE_FILE that grows the file"` exits 0
   - `npx vitest run src/engine/adr-amend.test.ts -t "FR-026: registers the amendment and regenerates the index in one invocation"` exits 0
5. **Given** the retrofitted records, **When** their registries are inspected, **Then**:
   - `grep -q '^## Amendments' docs/decisions/ADR-005-tdd-gate-architecture.md` exits 0
   - `grep -q '^## Amendments' docs/decisions/ADR-007-single-dispatch-path.md` exits 0
   - `grep -A20 '^## Amendments' docs/decisions/ADR-007-single-dispatch-path.md | grep -q '026'` exits 0

### US-010 - A citation that resolves to nothing fails CI (Priority: P0)
As CI, I run `gwrk define adr --check` and it exits non-zero on the phantom `028 correction` at [`ship-orchestrator.ts:492`](../../src/engine/ship-orchestrator.ts) — the defect that motivated this feature, and the one a resolver keyed only on `ADR-\d+` would have passed.

**Implements**: FR-024, FR-025

**Independent Test**: Run the checker over a fixture tree containing a `028 correction` citation and an ADR-007 whose `## Amendments` registry lacks it; assert exit 1 with the citing `file:line` in stderr. Add the registered amendment and assert exit 0. Separately assert an unresolvable `ADR-099` citation and an index hash mismatch each exit 1.

**Acceptance Scenarios**:
1. **Given** a `028 correction` citation with no registered amendment, **When** `--check` runs, **Then**:
   - `npx vitest run src/engine/adr-check.test.ts -t "FR-024: reports an unregistered NNN correction citation"` exits 0
   - `npx vitest run src/engine/adr-check.test.ts -t "FR-024: names the citing file and line"` exits 0
2. **Given** the amendment is registered, **When** `--check` runs, **Then**:
   - `npx vitest run src/engine/adr-check.test.ts -t "FR-024: passes once the amendment is registered"` exits 0
3. **Given** an `ADR-099` citation, **When** `--check` runs, **Then**:
   - `npx vitest run src/engine/adr-check.test.ts -t "FR-024: reports an ADR citation with no file in docs/decisions"` exits 0
4. **Given** the repaired tree, **When** `--check` runs against it, **Then**:
   - `node dist/index.js define adr --check` exits 0
   - `grep -q '028 correction' docs/decisions/ADR-007-single-dispatch-path.md` exits 0
   - `grep -q 'Gate authority is one-way\|is one-way' docs/decisions/ADR-007-single-dispatch-path.md` exits 0
5. **Given** CI, **When** the workflow is inspected, **Then**:
   - `grep -rq 'define adr --check' .github/workflows/` exits 0

### US-011 - Ratification is modelled, and the diff is the gate (Priority: P2)
As a maintainer, `gwrk define adr ADR-010 --decide` flips `Proposed` to `Decided`, stamps the date and regenerates the index with no workflow and no dispatch — and what makes ratification human is the mechanism the repo already relies on: the command produces a diff, the diff lands on a PR to `develop`, a human merges. The CLI claims no permission it does not have.

**Implements**: FR-023, FR-026

**Independent Test**: Drive `--decide` on a `Proposed` fixture and assert the status flips, the date is stamped, the index regenerates, and no `WorkflowRuntime` is constructed. Drive it on an already-`Decided` record and assert a non-zero exit.

**Acceptance Scenarios**:
1. **Given** a `Proposed` record, **When** `--decide` runs, **Then**:
   - `npx vitest run src/commands/adr.test.ts -t "FR-023: flips Proposed to Decided and stamps the date"` exits 0
   - `npx vitest run src/commands/adr.test.ts -t "FR-023: dispatches no workflow"` exits 0
   - `npx vitest run src/commands/adr.test.ts -t "FR-026: regenerates the index after --decide"` exits 0
2. **Given** an already-`Decided` record, **When** `--decide` runs, **Then**:
   - `npx vitest run src/commands/adr.test.ts -t "FR-023: refuses to re-decide a Decided record"` exits 0

### US-012 - The corpus gets audited for what a checker cannot decide (Priority: P2)
As a maintainer, `gwrk define adr --audit` dispatches the already-shipped `gwrk-constitution` builtin — valid manifest, `required: [summary, intents]`, referenced from no TypeScript today — narrowed to the ADR corpus and told where to write, reading the index rather than readdir-ing the corpus so the audit and the injected payload agree.

**Implements**: FR-027, FR-028

**Independent Test**: Assert `--audit` calls `executeWorkflow("gwrk-constitution", …)` with an appended `<decision_context>` block naming `docs/decisions/` and the index path. Grep the prompt for the removed `spec.md` invariant line and the index reference. Grep `gwrk-analyze/PROMPT.md` for a seventh detection pass naming the index.

**Acceptance Scenarios**:
1. **Given** `--audit`, **When** the handler executes, **Then**:
   - `npx vitest run src/commands/adr-dispatch.test.ts -t "FR-027: dispatches gwrk-constitution for --audit"` exits 0
   - `npx vitest run src/commands/adr-dispatch.test.ts -t "FR-027: appends a decision_context block naming the corpus and the index"` exits 0
2. **Given** the constitution prompt, **When** it is inspected, **Then**:
   - `grep -q '.gwrk/decisions/index.md' src/plugins/builtins/workflows/gwrk-constitution/PROMPT.md` exits 0
   - `! grep -q 'invariants from .spec.md. files match implementation' src/plugins/builtins/workflows/gwrk-constitution/PROMPT.md` exits 0
3. **Given** the analyze prompt, **When** it is inspected, **Then**:
   - `grep -q '.gwrk/decisions/index.md' src/plugins/builtins/workflows/gwrk-analyze/PROMPT.md` exits 0
   - `grep -q 'ADR' src/plugins/builtins/workflows/gwrk-analyze/PROMPT.md` exits 0

---

## 3. Roles, Scopes & Permissions

_Leverages shared RBAC. No feature-specific roles. See RP-000._

One clarification, because §1.11 is explicit that it must be stated rather than implied:

- **RP-001**: `--decide` is a local file edit behind a command. An agent **can** run it; nothing in gwrk can prevent that, and a guard claiming otherwise would be theatre. Ratification is human because the edit produces a diff, the diff lands on a PR to `develop`, and a human merges — the same mechanism every `gwrk ship` run already relies on. This spec MUST NOT ship a permission check implying otherwise.

---

## 4. Functional Requirements

### Phase 1 — Author

- **FR-001**: System MUST expose `gwrk define adr` as an exported `Command` in its own module `src/commands/adr.ts`, registered on `defineCommand` alongside `researchCommand`, with an `Examples:` help block and `adr` added to the parent `define` `Examples:` block. The action MUST wrap its work in `withSignal("define adr", …)` so the `[exit:N | Xs]` line ADR-004 requires is emitted — D12 records that `define research` skips this, and `define adr` MUST NOT copy it. (Implements: US-001)
- **FR-002**: System MUST allocate `ADR-NNN`, zero-padded to three, as max+1 over `docs/decisions/` entries matching `/^ADR-(\d{3})-/`, fixing the three flaws of the research allocator: filter on the `.md` suffix **and** the pattern rather than a raw readdir; **fail** naming the conflicting path if `ADR-NNN-*.md` already exists at the computed number, rather than silently writing a sibling; and discover the project root by walking parents for `.gwrkrc.json`, as `init.ts` does, rather than joining `process.cwd()` with literals. No locking — two concurrent runs both compute the same number and the existence check makes the second fail loudly. (Implements: US-001)
- **FR-003**: System MUST write the §4.1 template: the blockquote header (`Status: Proposed`, today's date, `Decision:`, `Constraint:`, optional `Depends on:` / `Supersedes:`, `Author:` · `Decision Scope:`), then numbered sections §1 Context, §2 Decision with numbered assertion sub-headings, §3 Decision Record (the four-row `Position`/`Confidence`/`Reversibility`/`Risk` table used by 004–009, not a fourth shape), §4 Alternatives Rejected, §5 Impact on Existing Code, §6 Consequences, §7 References, §8 Amendments — the last starting empty as the registry `--check` reads. (Implements: US-001)
- **FR-004**: System MUST parse the blockquote header the nine records already use, tolerating every documented corpus inconsistency: two H1 styles (`# ADR: <title>` in 001–002 with the number only in the filename, `# ADR-00N: <title>` in 003–009); ADR-001's trailing double-space hard breaks; ADR-001's absent `Supersedes` and `Depends on`; `·` separating two fields on one line (`Status` with `Date`, `Author` with `Decision Scope`); and `Decision:` values up to 240 characters, which the index truncates. (Implements: US-002)
- **FR-005**: System MUST extract each record's heading tree, so a section address resolves to a heading that exists and an address that does not (`ADR-007 §9.9`) is reported unresolvable. (Implements: US-002, US-009)
- **FR-006**: System MUST reconcile the corpus in place — no file rewritten, nothing deleted or reordered — with migration edits 1–5: H1 → `# ADR-00N: <title>` (001, 002); `Status: Proposed` → `Decided` (006, 007), because ADR-008 and ADR-009 both declare `Depends on: ADR-007` and ADR-006 is cited from `agent-backend.ts`, `manifest.ts`, `agent-registry.ts` and `agent.ts`; a relative `Supersedes` link replacing the dead `file:///Users/gonzo/…` (002); deduplication of the two `## 7.` headings so section addressing is unambiguous (001); and the W4 `028 correction` block, whose markdown already exists at [`docs/code-review-verdict-defect.md:422-431`](../../docs/code-review-verdict-defect.md), applied to 007. (Implements: US-002, US-010)
- **FR-007**: System MUST ship `gwrk-adr-record` as a builtin workflow — `manifest.yaml` (`name: gwrk-adr-record`, version `1.0.0`, `outputSchema` with `required: [summary, intents]`) plus `PROMPT.md` with no substitution placeholders — and `--run` MUST dispatch it through `WorkflowRuntime.executeWorkflow` with the title, `{agent, model}`, and `projectRoot`. Passing `projectRoot` is a deliberate divergence from `define research --run`, which omits it and so falls back to a default `PluginLoader` with no `projectDir`, making project-local overrides invisible. Without `--run`, no runtime is constructed. (Implements: US-003)
- **FR-008**: System MUST declare neither `--refs` nor `--dry-run` on `define adr`. `--refs` is meaningless for an ADR; the dry-run affordance ships as `--print`, avoiding the parent's `--dry-run`. This keeps the nine-entry collision baseline in [`cli.option-collisions.test.ts:31-51`](../../src/cli.option-collisions.test.ts) (eight `HANDLED` plus one `VERIFIED_BENIGN`) intact. Avoidance is chosen over allowlisting because that test asserts set equality of discovered collisions and never that `withParentFlags` is called — so an allowlist entry alone turns CI green on a broken flag, which is exactly how D1 shipped. (Implements: US-001, US-003)

#### FR-002 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| `ADR-NNN-*.md` exists at the computed number | `ADR-010 already exists: docs/decisions/ADR-010-<slug>.md` | 1 |
| No `.gwrkrc.json` in any parent directory | `Not a gwrk project: no .gwrkrc.json found in <cwd> or any parent. Run: gwrk init` | 1 |
| Empty title argument | `Title is required: gwrk define adr "<title>"` | 1 |
| `docs/decisions/` unwritable | `Cannot write docs/decisions/: <errno>` | 1 |

#### FR-007 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| `gwrk-adr-record` not resolvable by the loader | `Workflow not found: gwrk-adr-record. Run: npm run build` | 1 |
| Workflow returns output failing `outputSchema` | `gwrk-adr-record returned no valid {summary, intents}` | 1 |
| `--run` with no configured backend | `No agent backend available. Run: gwrk plugin list agents` | 1 |

### Phase 2 — Index and inject

- **FR-009**: System MUST generate `.gwrk/decisions/index.md` from the parsed corpus at command time — after any `gwrk define adr` write, on `gwrk define adr --reindex` alone, and from `gwrk init` when `docs/decisions/` is non-empty — carrying a content hash over the parsed headers. Dispatch-time derivation is rejected: the grounding loop does three `existsSync` calls today, and nine file reads plus a parse on every dispatch, three or more per ship iteration, buys freshness the command-time trigger already provides. Hand maintenance is rejected: it rots at ADR-010. (Implements: US-004, US-005, US-008)
- **FR-010**: System MUST add a `> **Constraint:**` header field — one imperative sentence, `MUST` or `MUST NOT` — to the template and to all nine existing records, each lifted from that record's `Decision Record` block (present in 004–009). The field is authored, not derived: it is not in the header today. The one-sentence cap is what defers the injection-budget ceiling to roughly ADR-030. (Implements: US-005)
- **FR-011**: System MUST render the index as `| ADR | Scope | Status | Constraint |`, one row per record, **never filtered by status**. Filtering is what made stale status dangerous — a `Status: Decided` filter would drop ADR-006 and ADR-007, the two records defining the dispatch path any injection rides on. Status vocabulary is `Proposed | Decided | Superseded`; `Accepted` is rejected as a synonym for the `Decided` the corpus already uses, and `Rejected`/`Deprecated` are deferred until a real instance exists. (Implements: US-004, US-005)
- **FR-012**: System MUST carry each `Supersedes` qualifier verbatim into the row (`Decided · superseded in part by ADR-002 (storage mechanism only)`) and MUST **derive** the inverse edge onto the superseded record's row from the forward field alone. Flattening to a boolean would tell an agent to ignore ADR-001, whose Hard Gate Architecture is live and cited from ADR-005's header. Forward-only recording stays sufficient and no corpus edit records a back-reference. (Implements: US-006)
- **FR-013**: System MUST add a fourth entry to the `groundingFiles` array at [`agent.ts:567-581`](../../src/utils/agent.ts): `.gwrk/decisions/index.md` → `<architecture_decisions>`, injected **uniformly** with no scope or stage filter, and inheriting the loop's fail-open behaviour — a missing file skipped silently, an unreadable one printing a dim warning while dispatch continues, exactly as the three existing rows behave. `--reindex --check` is where absence becomes detectable. The index MUST NOT live at `docs/decisions/INDEX.md`, because `source-scanner.ts:57-69` readdirs that directory and would push the index into the ontology prompt, doubling the corpus there; keeping the derived artifact under `.gwrk/` also keeps `docs/decisions/` purely human-authored. (Implements: US-004)
- **FR-014**: System MUST support `gwrk define adr --reindex` (regenerate) and `--reindex --check` (verify), the latter exiting non-zero when the stored hash disagrees with the parsed corpus. (Implements: US-008)
- **FR-015**: System MUST add a `material.decisions` field to `source-scanner` and stop pushing ADRs into `material.patterns` at `:57-69`, and `define-ontology.ts` MUST render it under its own heading rather than the `## Code Patterns` heading at `:48-49`. On this path the index replaces the corpus. (Implements: US-007)
- **FR-016**: System MUST replace all three stale ADR enumerations with an index reference: the `> **Decisions:**` line in `plan-renderer.ts:38` becomes one link; `gwrk-plan/PROMPT.md:60-65` becomes a read-the-index instruction plus a reference to the `<architecture_decisions>` tag; and `docs/grounding/architecture.md` has its three anchors (`:4`, `:19-24`, `:206`) and their dead `file:///Users/gonzo/…` links replaced with the index reference and relative links — the highest-leverage of the three, since `gwrk-specify/PROMPT.md:25` loads that file on every specify run. `gwrk-plan/PROMPT.md:147` MUST be repaired to route "Architecture decisions" to the index rather than the nonexistent `decision-forge` skill. Because no substitution engine exists (TC-008), the index reaches a prompt by file read, and reaches a dispatch by the `<architecture_decisions>` tag — the two mechanisms `gwrk-plan/PROMPT.md:102` and `gwrk-specify/PROMPT.md:29` already use for ADR-004. (Implements: US-007)
- **FR-017**: `gwrk init` MUST generate the index when `docs/decisions/` is non-empty, near the scaffold block at [`init.ts:429-441`](../../src/commands/init.ts) that already creates that directory. (Implements: US-008)
- **FR-018**: System MUST add exactly one hand-written pointer line to `.gwrk/agent-context.md` naming `.gwrk/decisions/index.md` as authoritative — buying reach for interactive `claude` and `codex` sessions, which read `CLAUDE.md` natively and never pass through `dispatchToAgent`. One line, no generator: `syncGovernance` replaces the whole marker block with the whole file, so a generated index there would either own the file and destroy the six hand-written lines or require a composer, which is the ownership ambiguity that rots. (Implements: US-007)
- **FR-019**: The scaffolder MUST read `project.architecture.decisions` from [`config.ts:86-95`](../../src/utils/config.ts) — declared today and read by nothing — defaulting to `docs/decisions`. No schema change; one `loadConfig` call turns a declared-but-dead seam into the configuration point. (Implements: US-001)

#### FR-014 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Stored hash disagrees with the parsed corpus | `Decision index is stale. Run: gwrk define adr --reindex` | 1 |
| `.gwrk/decisions/index.md` absent under `--check` | `No decision index at .gwrk/decisions/index.md. Run: gwrk define adr --reindex` | 1 |
| A record's header is unparseable | `docs/decisions/ADR-0NN-<slug>.md: no blockquote header found after the H1` | 1 |

### Phase 3 — Amend and check

- **FR-020**: System MUST support `gwrk define adr <ADR-NNN> --amend --at <section>`, inserting an inline correction blockquote at the end of the addressed section's body, with placement resolved through the parsed heading tree and **never** a line number. This is the form ADR-007 already uses at `:80` (`> **026 correction.**`), correct when the original sentence stays true in a narrower reading. The command emits a full-file `WRITE_FILE`, because `IntentEngine` executes only `WRITE_FILE`, `CREATE_DIR` and `RUN_COMMAND` ([`intent-engine.ts:54-119`](../../src/engine/intent-engine.ts)) with no patch or append verb; the `wouldShrinkExistingFile` guard ([`workflow-runtime.ts:155-160`, `:490-501`](../../src/plugins/workflow-runtime.ts)) is satisfied because an amendment always grows the file, and path containment ([`intent-engine.ts:59-64`](../../src/engine/intent-engine.ts)) is satisfied by a path under the project root. (Implements: US-009)
- **FR-021**: System MUST support `--append-section`, appending a new top-level section numbered max+1 over existing `## N.` headings — the form ADR-005 already uses (`## 8. Amendment: … (2026-03-16)` with `> **Amends:** §2.3, §2.4`), correct when the change needs its own context and consequences. Both forms stay; each is correct for a different kind of change. (Implements: US-009)
- **FR-022**: Each record MUST carry a final `## Amendments` section listing every correction block it holds, keyed by the amending record's id. Retrofit is bounded to the two records that already carry amendments: ADR-005 (appended sections §8–§12) and ADR-007 (the inline `026 correction` at `:80`). Two files, not nine. (Implements: US-009, US-010)
- **FR-023**: System MUST support `gwrk define adr <ADR-NNN> --decide`, flipping `Proposed` to `Decided`, stamping the date, and regenerating the index — with no workflow and no dispatch. Per RP-001 this ships no permission guard. (Implements: US-011)
- **FR-024**: System MUST support `gwrk define adr --check`, exiting non-zero on any of three mechanical assertions: every `ADR-\d+` cited in `src/`, `docs/` or `specs/` resolves to a file in `docs/decisions/`; every `NNN correction` cited resolves to a **registered** amendment; and the index hash matches the parsed corpus headers. Against today's tree, assertion 2 reports `src/engine/ship-orchestrator.ts:492` citing a `028 correction` that ADR-007 does not carry — this is the assertion that closes D13. (Implements: US-010)
- **FR-025**: The `028 correction` citation at [`ship-orchestrator.ts:492`](../../src/engine/ship-orchestrator.ts) MUST be corrected to the registered amendment address once FR-006 has applied the block and FR-022 has registered it. (Implements: US-010)
- **FR-026**: Every mutating invocation — a scaffold write, an amendment, an appended section, a `--decide` — MUST update the amendment registry where applicable and regenerate the index in the same command. The cascade is executed, not remembered. (Implements: US-009, US-011)

#### FR-020 / FR-021 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| `--at <section>` resolves to no heading | `ADR-007 §9.9: no such section. Sections: 1, 2, 2.1, 2.2, 2.3, 3, …` | 1 |
| `<ADR-NNN>` resolves to no file | `ADR-042 not found in docs/decisions/` | 1 |
| `--amend` without `--at` or `--append-section` | `--amend requires --at <section> or --append-section` | 1 |
| Resulting content would shrink the file | `Refusing to shrink docs/decisions/ADR-007-…md; an amendment must grow it` | 1 |

#### FR-023 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Record is already `Decided` | `ADR-010 is already Decided (2026-08-20)` | 1 |
| Record is `Superseded` | `ADR-001 is Superseded; --decide does not apply` | 1 |

#### FR-024 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| `ADR-\d+` citation resolves to no file | `<file>:<line>: ADR-099 does not resolve to a file in docs/decisions/` | 1 |
| `NNN correction` citation is unregistered | `<file>:<line>: cites a '028 correction' not registered in ADR-007's ## Amendments` | 1 |
| Index hash disagrees with the corpus | `Decision index is stale. Run: gwrk define adr --reindex` | 1 |

### Phase 4 — Audit

- **FR-027**: System MUST wire the already-shipped `gwrk-constitution` builtin behind `gwrk define adr --audit` — it has a valid manifest with a well-formed `outputSchema` carrying `required: [summary, intents]`, and is referenced from no TypeScript today — with three prompt changes: append a `<decision_context>` block naming `docs/decisions/` and the index path, mirroring how `research.ts:114` appends `<research_context>`, because the prompt currently tells the agent nothing about where to write; narrow the line "Check that invariants from `spec.md` files match implementation", which is scope creep for an ADR audit and duplicates `define analyze`; and read the index rather than readdir the corpus, so the audit and the injected payload agree. (Implements: US-012)
- **FR-028**: `gwrk-analyze/PROMPT.md` MUST gain a seventh detection pass for contradiction with a recorded decision, reading `.gwrk/decisions/index.md`. The string "ADR" appears zero times in its current 215 lines. Semantic contradiction is judgment, so it reports rather than gates, and `analyze` is already the definitional quality gate with a Principal Engineer persona. (Implements: US-012)

### Command classification (ADR-004 agent-native compliance)

| Invocation | Type | Exit 0 | Exit 1 | `--format json` |
|---|---|---|---|---|
| `gwrk define adr "<title>"` | generator | record written, index regenerated | collision, no project root, empty title | N/A — writes a file; path on stdout |
| `gwrk define adr "<title>" --run` | generator (dispatching) | workflow returned `{summary, intents}` | workflow missing, schema violation, no backend | N/A |
| `gwrk define adr --print` | query | template printed to stdout, nothing written | no project root | supported |
| `gwrk define adr --reindex` | generator | index written | unparseable header | N/A |
| `gwrk define adr --reindex --check` | verifier | hash matches | stale, absent, unparseable | supported |
| `gwrk define adr <id> --amend --at <s>` | mutator | inserted, registered, reindexed | unresolvable address or id, would shrink | N/A |
| `gwrk define adr <id> --append-section` | mutator | appended, registered, reindexed | unresolvable id | N/A |
| `gwrk define adr <id> --decide` | mutator | status flipped, index regenerated | already `Decided`, `Superseded`, unknown id | N/A |
| `gwrk define adr --check` | verifier | all three assertions pass | any assertion fails, one finding per line | supported |
| `gwrk define adr --audit` | generator (dispatching) | report returned | workflow missing, no backend | N/A |

Every failure message above is error-as-navigation: it names the offending path or id and, where one exists, the corrective command.

---

## 5. Data Model Requirements

_No database entities required for this feature. See DM-000._

Two structural notes, both load-bearing:

- **DM-001**: There is **no spine node** for an ADR — no table, no `plan_features` row, no `tasks.json` entry. `docs/decisions/*.md` is the sole record and `.gwrk/decisions/index.md` is a derived projection of it. A `plan_proposals`-style approval table is rejected: it is dead code (`insertProposal` writes an `updated_at` column the table lacks), hard-bound to `target_phase_id NOT NULL`, and forbidden by TC-007.
- **DM-002**: The index's content hash is computed over the **parsed headers** of the corpus, not over raw file bytes, so prose edits below the header do not report the index stale.

---

## 6. Technical Constraints

- **TC-001**: Air-Gapped — No external network calls at runtime. No CDN. No telemetry.
- **TC-002**: Fail-Fast Config — Zod validation with no `.default()` calls. Missing var → `process.exit(1)`.
- **TC-003**: TypeScript Only — No `.js` or `.jsx` in `src/`. ESM modules, ES2022 target.
- **TC-004**: **No fifth carrier.** `docs/decisions/` stays the single source of truth. The index is a derived projection delivered through the grounding channel, plus one hand-written pointer line in `.gwrk/agent-context.md`. Nothing else may become a place decisions live.
- **TC-005**: **An ADR is a document, not a requirement.** `ADR-NNN` stays a citable id the plan language accepts; no requirement semantics are added. Building resolution checking for ADRs alone would give decisions stronger verification than `FR-` ids have, inverting the dependency — `FR-` ids are what specs are built from, and nothing checks those either. What this feature takes from the requirement framing is a citation resolver over `docs/decisions/` (FR-024), not a coupling to the plan graph.
- **TC-006**: **No `drift-detector` change.** `getDriftArtifacts()` is referenced only by its own test; `plan verify` calls `verify()`, which never reads it. `verify()` is also the wrong shape — it reconciles `specs/` directories against `plan_features` rows and `tasks.json` statuses and reads no document text. Adding `"docs/decisions"` is a no-op and MUST NOT be done.
- **TC-007**: **Blockquote metadata, not YAML frontmatter.** The blockquote header is a house convention, not an ADR quirk: `plan-renderer.ts:33-38` emits `> **Status:** Authoritative · **Date:** ${date}` into every generated build plan, and `docs/grounding/architecture.md:3-4` uses the identical form. One parser reads all three artifact families. YAML would cost nine file rewrites and permanently diverge from `plan-renderer`.
- **TC-008**: **No placeholder substitution.** No substitution engine exists (proven twice, D6 and D7), so a `PROMPT.md` cannot interpolate the index. Prompts reach it by file read or by the `<architecture_decisions>` tag. No design in this feature may depend on placeholder interpolation.
- **TC-009**: **Uniform injection.** The grounding loop has no scope filter, unlike `resolveEnforcementSkills(projectRoot, scope, profile)`. Adding one changes the loop's shape for a single row, and a definition-only gate would exclude IMPLEMENT and review — the two stages with the highest demand and zero decision references today. Revisit only above roughly 1,000 injected tokens.
- **TC-010**: **Injection budget.** Nine rows at roughly 37 tokens each plus a three-line preamble lands near 380 tokens, about +25% on today's real grounding payload (`domain.md` alone at ~1,500 tokens, since `.gwrk/perspective/` does not exist). Roughly 35 tokens per future ADR; the one-sentence `Constraint` cap defers the ceiling to roughly ADR-030.
- **TC-011**: **Nothing in this feature may be named "cascade."** `gwrk-cascade-sync` is an existing unwired builtin whose algorithm propagates a source change to consumer modules, ending in `pnpm build` and `pnpm test` — a code cascade, not a definitional one. The name collision would read as a wire-up of an existing workflow when it is not.
- **TC-012**: **Builtins ship through the build.** A builtin needs `manifest.yaml` plus `PROMPT.md`, and `postbuild` copies the tree. Real `gwrk` runs `dist/`, so `npm run build` is not optional for any prompt or manifest change in this feature.
- **TC-013**: **No option collisions.** `define adr` declares neither `--refs` nor `--dry-run`. The dry-run affordance is `--print`. The nine-entry baseline in `cli.option-collisions.test.ts` MUST remain nine, and no allowlist entry may be added — that test asserts set equality of discovered collisions and never that `withParentFlags` is called, so an allowlist entry alone turns CI green on a broken flag.
- **TC-014**: **Bare-clone operable.** Authoring, parsing, indexing, amending and checking are discovery-class operations that MUST work from a bare git clone — no SQLite, no build server. Nothing in this feature may require either.
- **TC-015**: **No locking.** Numbering matches research and specs: two concurrent runs both compute the same number, and FR-002's existence check makes the second fail loudly. A lockfile is out of proportion to a human-paced command.
- **TC-016**: **Fail-open grounding, deliberately inherited.** A missing index is skipped silently and an unreadable one warns dimly while dispatch continues — matching the three existing rows. Detection of absence belongs to `--reindex --check`, not to dispatch.

---

## 7. Testing Requirements

- **TR-001**: `src/engine/adr-scaffold.test.ts` — mock `node:fs/promises` wholesale. Assert `mkdir`/`writeFile` arguments; max+1 numbering over an `ADR-001`…`ADR-009` fixture; the `.md`-suffix-and-pattern filter against a readdir result containing directories and stray files; loud failure naming the conflicting path on a same-number different-slug collision, with `writeFile` never called; project-root discovery by walking parents for `.gwrkrc.json`; and `project.architecture.decisions` honoured with a `docs/decisions` default. Vitest. (FR-002, FR-003, FR-019)
- **TR-002**: `src/engine/adr-parser.test.ts` — fixtures reproducing **all four** documented header inconsistencies (two H1 styles, ADR-001's hard breaks, ADR-001's absent relations, `·` field separation), plus a 240-character `Decision:` value and heading-tree extraction including a duplicate-heading fixture. Fixtures, **never** `docs/decisions/`: a corpus-coupled suite breaks when ADR-010 lands, and `retry: 1` in `vitest.config.ts` would surface that as flake. Vitest. (FR-004, FR-005)
- **TR-003**: `src/commands/adr.test.ts` — handler-level, per `research.test.ts`: import `adrCommandHandler`, mock the engine, assert the returned string. `console.log` stays in the action. Covers `--print`, `--decide` on a `Proposed` record, refusal on an already-`Decided` one, and the index regeneration that follows `--decide`. Vitest. (FR-001, FR-023, FR-026)
- **TR-004**: `src/commands/adr-dispatch.test.ts` — per `research-dispatch.test.ts`: mock `WorkflowRuntime`, `node:fs/promises`, `loadConfig`, `resolveModelForTask`. Assert `executeWorkflow` receives `gwrk-adr-record`, an input containing the title, `{agent, model}`, and `projectRoot`; assert the runtime is never constructed without `--run`; assert `--audit` dispatches `gwrk-constitution` with an appended `<decision_context>` block. Vitest. (FR-007, FR-027)
- **TR-005**: `src/engine/adr-index.test.ts` — row generation against a nine-record fixture including two `Proposed`; the `| ADR | Scope | Status | Constraint |` header; no status filtering; `Constraint` projection; derived back-references with qualifiers preserved verbatim for both ADR-002's parenthetical and ADR-003's free-text form; hash stability across identical input and divergence on a mutated header; and a token-budget assertion against TC-010. Vitest. (FR-009, FR-010, FR-011, FR-012, FR-014)
- **TR-006**: `src/engine/adr-check.test.ts` — citation resolution over a fixture tree, with the phantom `028 correction` as the headline case: exit 1 naming the citing `file:line` when unregistered, exit 0 once registered. Plus an unresolvable `ADR-099` citation and an index-hash mismatch. Vitest. (FR-024, FR-025)
- **TR-007**: `src/engine/adr-amend.test.ts` — section-addressed insertion against an ADR-007 fixture: insertion at the end of §2.1's body; resolution through the heading tree rather than a line number; non-zero exit on `§9.9`; `--append-section` numbering max+1 over existing `## N.` headings; a full-file `WRITE_FILE` intent that grows the file (so `wouldShrinkExistingFile` does not drop it); and registry update plus index regeneration in one invocation. Vitest. (FR-020, FR-021, FR-022, FR-026)
- **TR-008**: `src/utils/agent.grounding-decisions.test.ts` — `<architecture_decisions>` injected when `.gwrk/decisions/index.md` exists; skipped silently when absent; dispatch continuing with a dim warning when unreadable; and the payload identical across stages, asserting no scope or stage filter was introduced. Vitest. (FR-013)
- **TR-009**: `src/cli.ux.test.ts` — add `"define adr"` to `commandsWithExamples` at `:43-55`. Without this the `Examples:` invariant goes unenforced for the new command. Vitest. (FR-001)
- **TR-010**: `src/cli.e2e.test.ts` — assert `adr` appears in `define --help` at `:75-88`. The existing assertion passes untouched — `adr` is not in the `hidden` list `["analyze","specify","generate","implement","ship"]` — so asserting it is the deliberate move rather than an incidental pass. Vitest, spawns the built CLI. (FR-001)
- **TR-011**: `src/engine/source-scanner.test.ts` and `src/commands/define-ontology.test.ts` — assert ADRs land in `material.decisions`, that `material.patterns` no longer receives them, and that the ontology grounding material renders decisions under their own heading rather than `## Code Patterns`. Vitest. (FR-015)
- **TR-012**: `src/engine/plan-renderer.test.ts` — assert the rendered build-plan header carries one index link and no per-ADR enumeration. Vitest. (FR-016)
- **TR-013**: `src/commands/init.test.ts` — assert `gwrk init` writes the index when `docs/decisions/` is non-empty and writes none when it is empty. Vitest. (FR-017)
- **TR-014**: Corpus and prompt invariants, asserted as shell greps in the acceptance scenarios rather than a vitest suite, because they assert the state of checked-in markdown: reconciled H1 styles; no `file:///Users/gonzo` anywhere in `docs/decisions/` or `docs/grounding/architecture.md`; one `## 7.` in ADR-001; no `Status: Proposed` in 006/007; a `Constraint:` field in all nine; `## Amendments` in 005 and 007; the index reference in both prompts, `architecture.md` and `.gwrk/agent-context.md` (exactly once); no `decision-forge`; no `{{PLACEHOLDER}}` in the new prompt; and `define adr --check` in a CI workflow. (FR-006, FR-010, FR-016, FR-018, FR-022, FR-028)
- **TR-015**: DEFERRED — no `cli.option-collisions.test.ts` change. Per FR-008 and TC-013, `define adr` declares neither colliding flag, so the nine-entry baseline holds and both assertions pass untouched. A flag that cannot collide cannot repeat D1.
- **TR-016**: DEFERRED — no `cli.consistency.test.ts` change. Its feature-argument list is ten hardcoded command paths and the `define adr` positional is a title or an `ADR-NNN` id, not a feature.
- **TR-017**: DEFERRED — no `drift-detector.test.ts` change. Per TC-006 nothing is added to `getDriftArtifacts()`.

### Harness constraints (source §5)

- Test titles MUST embed an `FR-`, `US-` or `TR-` id. `scripts/dev/test-report.ts` extracts the first matching token (`/(?:FR|US|TR)-[A-Z0-9]+/i` at `:114`) and maps it through the spec's `gap-matrix.md`.
- The pre-commit hook is **not installed** in this clone — `.git/hooks/pre-commit` is absent and `core.hooksPath` is unset. The three-line MPL header MUST be added to every new `.ts` file by hand, and `npm run build` MUST be run manually.
- `tsconfig.json:15` excludes `**/*.test.ts` and biome ignores most test globs, so type and lint errors in new test files are invisible to both gates; lint also runs `continue-on-error` in CI. New suites MUST be run locally, not assumed green.
- Suites MUST stay hermetic — no git, no live corpus — so no `GWRK_SKIP_INTEGRATION` quarantine entry is needed.

---

## 8. Success Criteria

- **SC-001**: `gwrk define adr "<title>"` produces `docs/decisions/ADR-010-<slug>.md` at the correct number from any subdirectory, and refuses rather than writing a sibling when that number is taken.
- **SC-002**: All nine existing records parse — status, decision, relations, heading tree — with no file rewritten, nothing deleted, and nothing reordered.
- **SC-003**: `docs/decisions/ADR-010-decision-records.md` exists, written by the command this feature ships. The feature records its own decision using its own machinery.
- **SC-004**: Every dispatch through `dispatchToAgent` receives `<architecture_decisions>` when the index exists, including IMPLEMENT and all four review stages — which receive zero decision references today.
- **SC-005**: An implementer reading ADR-007's index row learns that a `spawn("claude")` is forbidden, which its `Decision:` line alone does not convey.
- **SC-006**: No ADR is omitted from the index for any reason, including status. ADR-006 and ADR-007 — the two records defining the dispatch path the injection rides on — appear whatever their status field says.
- **SC-007**: `gwrk define adr --check` exits non-zero on today's tree because of `ship-orchestrator.ts:492`, and exits 0 after FR-006, FR-022 and FR-025 land. D13 is closed by a mechanism, not a memory.
- **SC-008**: `gwrk define adr --reindex --check` exits non-zero when the corpus has moved and the index has not, so staleness is detectable rather than assumed.
- **SC-009**: No hardcoded ADR enumeration remains in `plan-renderer.ts`, `gwrk-plan/PROMPT.md`, `gwrk-specify/PROMPT.md` or `docs/grounding/architecture.md`, and no `file:///Users/gonzo/…` link remains in `docs/decisions/` or `docs/grounding/architecture.md`.
- **SC-010**: `gwrk-constitution`, which is referenced from no TypeScript today, is reachable — and `gwrk-adr-record` is the only new workflow this feature adds.
- **SC-011**: The injected payload measures under 1,000 tokens with nine records, leaving headroom to roughly ADR-030 at the one-sentence `Constraint` cap.
- **SC-012**: Phase 1 delivers standalone value with no grounding change, no prompt change and no index: the corpus stops drifting in shape and the next decision gets written instead of remembered.

---

## 9. Verification Requirements

- **VR-001**: `npm run build` MUST be run before any assertion that invokes `node dist/index.js` or inspects `dist/plugins/builtins/`. Real `gwrk` runs compiled `dist/`, so a source-only change is unverified (TC-012).
- **VR-002**: `npx vitest run src/engine/adr-scaffold.test.ts src/engine/adr-parser.test.ts src/engine/adr-index.test.ts src/engine/adr-check.test.ts src/engine/adr-amend.test.ts src/commands/adr.test.ts src/commands/adr-dispatch.test.ts src/utils/agent.grounding-decisions.test.ts` MUST exit 0.
- **VR-003**: `npm run test:ci` MUST exit 0, confirming no regression in `cli.option-collisions.test.ts` (nine entries, unchanged), `cli.consistency.test.ts`, or `drift-detector.test.ts`.
- **VR-004**: The three-line MPL header MUST be present in every new `.ts` file, verified by inspection — the pre-commit hook is not installed in this clone.
- **VR-005**: New test files MUST be run locally before any completion claim; `tsconfig.json` excludes them and biome ignores most test globs, so neither gate would surface an error in them.
- **VR-006**: Each phase MUST be verified independently, in order. Phase 1 MUST pass VR-002's Phase 1 subset with no grounding change, no prompt change and no index present, confirming SC-012.
- **VR-007**: `gwrk define adr --check` MUST be observed exiting non-zero on the pre-fix tree and 0 on the post-fix tree. Asserting only the passing state would not demonstrate that the check can fail.
- **VR-008**: The injected payload size MUST be measured, not estimated, against TC-010's ~380-token figure and the 1,000-token revisit threshold.
- **VR-009**: This feature MUST NOT be verified by `gwrk ship` or the daemon. `gwrk ship` dispatch is human-only per the operating model, and Phase 2 changes the grounding payload every dispatch receives — including the review dispatches that would be judging the change.
- **VR-010**: The phase gate MUST be authored into `task.gateScript`, not `phase.doneWhen`; a fenced Done-When leaves `gateScript` empty and the gate never runs (026/027 lineage).

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|-------------|
| US-001 | FR-001, FR-002, FR-003, FR-008, FR-019 | FR-001 | US-001 | TR-003, TR-009, TR-010 |
| US-002 | FR-004, FR-005, FR-006 | FR-002 | US-001 | TR-001 |
| US-003 | FR-007, FR-008 | FR-003 | US-001 | TR-001 |
| US-004 | FR-009, FR-011, FR-013 | FR-004 | US-002 | TR-002 |
| US-005 | FR-009, FR-010, FR-011 | FR-005 | US-002, US-009 | TR-002 |
| US-006 | FR-012 | FR-006 | US-002, US-010 | TR-014 |
| US-007 | FR-015, FR-016, FR-018 | FR-007 | US-003 | TR-004 |
| US-008 | FR-009, FR-014, FR-017 | FR-008 | US-001, US-003 | TR-003, TR-009, TR-015 (deferred — no-collision-by-design) |
| US-009 | FR-020, FR-021, FR-022, FR-026 | FR-009 | US-004, US-005, US-008 | TR-005 |
| US-010 | FR-024, FR-025 | FR-010 | US-005 | TR-005, TR-014 |
| US-011 | FR-023, FR-026 | FR-011 | US-004, US-005 | TR-005 |
| US-012 | FR-027, FR-028 | FR-012 | US-006 | TR-005 |
| | | FR-013 | US-004 | TR-008 |
| | | FR-014 | US-008 | TR-005 |
| | | FR-015 | US-007 | TR-011 |
| | | FR-016 | US-007 | TR-012, TR-014 |
| | | FR-017 | US-008 | TR-013 |
| | | FR-018 | US-007 | TR-014 |
| | | FR-019 | US-001 | TR-001 |
| | | FR-020 | US-009 | TR-007 |
| | | FR-021 | US-009 | TR-007 |
| | | FR-022 | US-009, US-010 | TR-007, TR-014 |
| | | FR-023 | US-011 | TR-003 |
| | | FR-024 | US-010 | TR-006 |
| | | FR-025 | US-010 | TR-006 |
| | | FR-026 | US-009, US-011 | TR-003, TR-007 |
| | | FR-027 | US-012 | TR-004 |
| | | FR-028 | US-012 | TR-014 |

Twelve user stories, twenty-eight functional requirements, seventeen testing requirements. No orphans: every US is backed by ≥1 FR, every FR fulfils ≥1 US, and every FR maps to ≥1 TR. TR-015, TR-016 and TR-017 are `DEFERRED` with rationale and back-reference the constraints (TC-013, TC-006) that make them no-ops rather than gaps.

---

## 11. Cross-References & Compatibility

Read against every spec sharing this feature's source directories (`src/commands/`, `src/engine/`, `src/utils/`, `src/plugins/builtins/`) and its ADR contracts.

| Reference | Relationship | Conflict? |
|---|---|---|
| **[028-review-finding-liveness](../028-review-finding-liveness/spec.md)** | **Direct dependency, both ways.** 028's FR-011 (W4, outstanding) requires ADR-007 to carry the inline `028 correction` block. This spec's FR-006 delivers exactly that edit in Phase 1, using the markdown already written at `docs/code-review-verdict-defect.md:422-431`. FR-022 then registers it and FR-025 corrects the citing comment. **Landing FR-006 closes 028 FR-011.** | No conflict. See OQ-001 for the citation-form issue this surfaces |
| **ADR-004 agent-native output** | FR-001 requires `withSignal`, so `define adr` emits the `[exit:N \| Xs]` line. D12 records that `define research` skips this; FR-001 explicitly forbids copying that omission | No conflict — this spec complies where the precedent does not |
| **ADR-007 single dispatch path** | FR-007 and FR-027 dispatch through `WorkflowRuntime`, never a raw spawn. FR-006 amends ADR-007's own text; FR-022 adds its registry | No conflict. This feature adds no dispatch path |
| **ADR-009 project knowledge grounding** | FR-013 adds a fourth grounding row to the array ADR-009 established, inheriting its fail-open behaviour verbatim | No conflict — same mechanism, one more row |
| **ADR-006 plugin agent backends** | FR-006 flips its status `Proposed` → `Decided`. It is cited from `agent-backend.ts`, `manifest.ts`, `agent-registry.ts` and `agent.ts`, and ADR-008/ADR-009 both declare `Depends on: ADR-007` | No conflict — a correction, recording what is already true |
| **[014-plugin-system](../014-plugin-system/spec.md)** | FR-007 ships a builtin workflow under the three-layer plugin architecture. Its `plan.md` already cites ADR-006 and ADR-007 in six `Requirements Addressed:` lines — the convention TC-005 keeps as a convention | No conflict. TC-005 adds no requirement semantics, so those citations keep their current meaning |
| **[013-agent-native-interface](../013-agent-native-interface/spec.md)** | The command classification table follows its query/generator/verifier/mutator taxonomy | No conflict |
| **[023-plan-format-contract](../023-plan-format-contract/spec.md)** | FR-016 changes `plan-renderer.ts`'s **header** only — the `> **Decisions:**` line. No phase, task or `Requirements Addressed:` grammar is touched | No conflict. Verify with TR-012 that no other header field moves |
| **026 / 027 (gate lineage)** | VR-010 inherits their finding: the gate lives in `task.gateScript`, not `phase.doneWhen` | No conflict — a verification constraint, not a code dependency |
| **000-build-plan** | `specs/000-build-plan.md` §Dependency Graph stops at `019`; 023–029 are absent from it. This spec adds no graph node, and FR-016 changes how the plan's header cites decisions | No conflict. The graph's staleness is pre-existing; see OQ-004 |

### Shared-type compatibility

- `material.decisions` (FR-015) is an **additive** field on the `source-scanner` material type. `material.patterns` survives with a narrower population, so any other reader keeps compiling.
- `groundingFiles` (FR-013) is a local `Array<{path, tag}>` inside `dispatchToAgent`, not an exported type. A fourth entry changes no signature.
- No change to `project.architecture` in `config.ts` (FR-019 reads the already-declared `decisions` field). No Zod schema is modified anywhere in this feature.

---

## 12. Open Questions

- **OQ-001** — **`ADR-007 §78` is a line number dressed as a section address, and it is cited in seven live places.** Verified: `specs/028-review-finding-liveness/spec.md` (`:12`, `:91`, `:345`, `:421`), `specs/028-review-finding-liveness/checklists/requirements.md` (`:30`, `:73`), and `docs/code-review-verdict-defect.md` (`:182`, `:225`, `:419`). ADR-007's heading tree tops out at `## 6. References`, so **no §78 exists**; the cited text ("The agent's verdict is advisory. Gates are truth.") sits at line 78, inside `### 2.1` (which spans `:47`–`:86`). The correct section address is **`ADR-007 §2.1`**.
  **Assumption taken, so implementation is not blocked**: FR-024's three `--check` assertions cover `ADR-\d+` file resolution, `NNN correction` registration, and the index hash — **not** section-address resolution. So `ADR-007 §78` does not fail CI. FR-005's heading-tree resolution is consumed on demand by `--amend --at`, where an unresolvable address exits 1 (FR-020 error states). Under that reading nothing breaks and the seven citations can be corrected to `§2.1` as a follow-up.
  **The question for the plan**: should `--check` gain a fourth assertion resolving `ADR-NNN §X.Y` citations? It would catch this class, and it would immediately fail on seven existing citations — so it needs the corrections to land in the same change. Recommendation: defer to a Phase 3 follow-up, correct the seven citations there, and keep `--check` at three assertions until then.
- **OQ-002** — `Superseded` is in FR-011's vocabulary but no record carries it today, and §1.8 derives supersession as a row annotation rather than a status flip. Does a record whose every assertion is superseded get `Status: Superseded` written into its header, or is the derived back-reference the only representation? The index reads correctly either way. Recommendation: derived-only until a fully superseded record exists, consistent with §1.7's "unused vocabulary is unmaintained vocabulary".
- **OQ-003** — FR-024's assertion 1 scans `src/`, `docs/` and `specs/` for `ADR-\d+`. `docs/archive/` and `.claude/worktrees/` sit under paths that would match a naive walk and contain stale copies. The exclusion list needs settling at plan time; `node_modules` and `dist` are obvious, `docs/archive/` is a judgment call.
- **OQ-004** — `specs/000-build-plan.md` §Dependency Graph stops at `019` and omits 023–029 entirely. Pre-existing drift, not caused here, and FR-016 touches only the plan's header. Filed rather than fixed.
- **OQ-005** — `.gwrk/rules/*.md` (`operating-model.md`, `workspace.md`) is read by no live code path yet cited as prose from `.gwrk/agent-context.md:4` and `gwrk-plan/PROMPT.md:145-146`. Carrier 4 of §1.2 with authority "None". Out of scope here; worth a decision of its own.
- **OQ-006** — D3 (`specify.ts:125-127`: both ternary branches return `undefined`, so `--number` cannot choose a spec number, and a numeric prefix gets slugified into the name) was the sharpest blocker in §6. It is **moot for this spec**: `specs/028-review-finding-liveness/` and `specs/029-decision-records/` both already exist at the right numbers, so the ordering hazard did not fire. D3 itself remains unfixed and will bite the next feature. Filed. Related: D1/D2 (`--refs` discarded on `define research`, and the `HANDLED` entry documenting a `withParentFlags` call `research.ts` never makes) affect the workflow that builds this feature, not its runtime — FR-008 and TC-013 ensure `define adr` cannot repeat them.
