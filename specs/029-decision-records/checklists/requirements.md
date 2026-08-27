# Requirements Checklist: 029-decision-records

**Purpose**: Verify the decision-records spec is complete, traceable, and free of orphans before planning.
**Created**: 2026-08-20
**Feature**: [spec.md](../spec.md)
**Authoritative source**: [`docs/research/R012-adr-first-class/draft.md`](../../../docs/research/R012-adr-first-class/draft.md)

## User Stories

- [ ] US-001 An engineer records a decision without choosing its number (P0) — §1.17, Phase 1
- [ ] US-002 The nine existing records parse unchanged (P0) — §1.3, §4.2, Phase 1
- [ ] US-003 A scaffolded record can be drafted by an agent (P1) — §2 Phase 1, `gwrk-adr-record`
- [ ] US-004 Every dispatch learns what it may not do (P0) — §1.6, §1.12, Phase 2
- [ ] US-005 The index says what is forbidden, and hides nothing (P0) — §1.5, §1.7, Phase 2
- [ ] US-006 A partial supersession does not read as a retirement (P1) — §1.8, Phase 2
- [ ] US-007 The stale ADR lists point at the index instead of enumerating (P1) — §1.15, D9, D10, Phase 2
- [ ] US-008 Index staleness is detectable, not assumed (P1) — §1.4, Phase 2
- [ ] US-009 Amending a record is one command, not a remembered cascade (P1) — §1.9, §1.10, Phase 3
- [ ] US-010 A citation that resolves to nothing fails CI (P0) — §1.13, **D13**, Phase 3
- [ ] US-011 Ratification is modelled, and the diff is the gate (P2) — §1.11, Phase 3
- [ ] US-012 The corpus gets audited for what a checker cannot decide (P2) — §1.14, Phase 4

## Functional Requirements

### Phase 1 — Author
- [ ] FR-001 `gwrk define adr` exported `Command` in its own module, registered on `defineCommand`, `Examples:` block, wrapped in `withSignal` (US-001) — must not copy D12
- [ ] FR-002 `ADR-NNN` max+1, zero-padded; `.md`+pattern filter; loud collision failure; project-root discovery via `.gwrkrc.json`; atomic claim, no lock manager (US-001) — fixes the three research-allocator flaws
- [ ] FR-003 §4.1 template: blockquote header, numbered §1–§8, four-row `Decision Record` table, empty `## 8. Amendments` (US-001)
- [ ] FR-004 Parses the blockquote header with all four documented tolerances + 240-char `Decision:` (US-002)
- [ ] FR-005 Extracts the heading tree so a section address resolves or reports unresolvable (US-002, US-009)
- [ ] FR-006 Corpus reconciliation edits 1–5, in place, nothing rewritten/deleted/reordered (US-002, US-010) — **delivers 028 FR-011 (W4)**
- [ ] FR-007 `gwrk-adr-record` builtin (manifest + PROMPT, `required: [summary, intents]`); `--run` dispatches with title, `{agent, model}`, `projectRoot` (US-003)
- [ ] FR-008 No `--refs`, no `--dry-run`; dry-run affordance is `--print`; nine-entry collision baseline intact (US-001, US-003)

### Phase 2 — Index and inject
- [ ] FR-009 `.gwrk/decisions/index.md` generated at command time with a content hash over parsed headers (US-004, US-005, US-008)
- [ ] FR-010 `> **Constraint:**` field — one imperative sentence — in the template and all nine records (US-005)
- [ ] FR-011 `| ADR | Scope | Status | Constraint |`, one row per record, **never filtered**; vocabulary `Proposed \| Decided \| Superseded` (US-004, US-005)
- [ ] FR-012 Supersession qualifier verbatim; back-reference **derived** from the forward field (US-006)
- [ ] FR-013 Fourth `groundingFiles` row → `<architecture_decisions>`, uniform, fail-open; not `docs/decisions/INDEX.md` (US-004)
- [ ] FR-014 `--reindex` and `--reindex --check` (US-008)
- [ ] FR-015 `material.decisions` field; ADRs out of `material.patterns` / `## Code Patterns` (US-007)
- [ ] FR-016 Three stale lists replaced with an index reference; `gwrk-plan/PROMPT.md:147` repaired (US-007)
- [ ] FR-017 `gwrk init` generates the index when `docs/decisions/` is non-empty (US-008)
- [ ] FR-018 Exactly one hand-written pointer line in `.gwrk/agent-context.md` (US-007)
- [ ] FR-019 Scaffolder reads `project.architecture.decisions`, default `docs/decisions`; no schema change (US-001)

### Phase 3 — Amend and check
- [ ] FR-020 `--amend --at <section>` via heading tree, never a line number; full-file `WRITE_FILE` that grows (US-009)
- [ ] FR-021 `--append-section` numbered max+1 over `## N.` headings (US-009)
- [ ] FR-022 `## Amendments` registry; retrofit bounded to ADR-005 and ADR-007 (US-009, US-010)
- [ ] FR-023 `--decide` flips `Proposed`→`Decided`, stamps the date, reindexes; no workflow, no permission guard (US-011)
- [ ] FR-024 `--check` three mechanical assertions, non-zero exit; **assertion 2 closes D13** (US-010)
- [ ] FR-025 `ship-orchestrator.ts:492` citation corrected to the registered amendment address (US-010)
- [ ] FR-026 Every mutation updates the registry and regenerates the index in one command (US-009, US-011)

### Phase 4 — Audit
- [ ] FR-027 `--audit` wires `gwrk-constitution` with the three prompt changes (US-012)
- [ ] FR-028 Seventh detection pass in `gwrk-analyze/PROMPT.md` reading the index (US-012)

## Testing Requirements

- [ ] TR-001 `adr-scaffold.test.ts` — fs mocked wholesale; numbering, filter, collision, root discovery, config read (FR-002/003/019)
- [ ] TR-002 `adr-parser.test.ts` — fixtures for all four inconsistencies + 240-char decision + heading tree; **never the live corpus** (FR-004/005)
- [ ] TR-003 `adr.test.ts` — handler-level per `research.test.ts`; `--print`, `--decide`, refusal, reindex (FR-001/023/026)
- [ ] TR-004 `adr-dispatch.test.ts` — `gwrk-adr-record` + `projectRoot`; no runtime without `--run`; `--audit` → `gwrk-constitution` (FR-007/027)
- [ ] TR-005 `adr-index.test.ts` — rows, no filtering, `Constraint` projection, derived back-refs, hash stability, token budget (FR-009/010/011/012/014)
- [ ] TR-006 `adr-check.test.ts` — the phantom `028 correction` as the headline fixture; `ADR-099`; hash mismatch (FR-024/025)
- [ ] TR-007 `adr-amend.test.ts` — §2.1 insertion, `§9.9` failure, `--append-section` numbering, grows-the-file, one-invocation cascade (FR-020/021/022/026)
- [ ] TR-008 `agent.grounding-decisions.test.ts` — injected / skipped silently / warns-and-continues / no scope filter (FR-013)
- [ ] TR-009 `cli.ux.test.ts` — add `"define adr"` to `commandsWithExamples` (FR-001)
- [ ] TR-010 `cli.e2e.test.ts` — assert `adr` in `define --help`; passes untouched, so asserting it is deliberate (FR-001)
- [ ] TR-011 `source-scanner.test.ts` + `define-ontology.test.ts` — `material.decisions`, own heading (FR-015)
- [ ] TR-012 `plan-renderer.test.ts` — index link, no enumeration (FR-016)
- [ ] TR-013 `init.test.ts` — index written when non-empty, not when empty (FR-017)
- [ ] TR-014 Corpus and prompt invariants as shell greps (FR-006/010/016/018/022/028)
- [ ] TR-015 DEFERRED — no `cli.option-collisions.test.ts` change; no colliding flag declared (TC-013)
- [ ] TR-016 DEFERRED — no `cli.consistency.test.ts` change; the ADR positional is not a feature
- [ ] TR-017 DEFERRED — no `drift-detector.test.ts` change; `getDriftArtifacts()` is a no-op (TC-006)

## Technical Constraints

- [ ] TC-001 Air-Gapped; TC-002 Fail-Fast; TC-003 TypeScript-Only present
- [ ] TC-004 No fifth carrier — `docs/decisions/` is the single source of truth
- [ ] TC-005 An ADR is a document, not a requirement — no requirement semantics added
- [ ] TC-006 No `drift-detector` change — `getDriftArtifacts()` is unread by `verify()`
- [ ] TC-007 Blockquote metadata, not YAML — one parser reads ADRs, build plans and `architecture.md`
- [ ] TC-008 No placeholder substitution — file read or `<architecture_decisions>` tag only (D6, D7)
- [ ] TC-009 Uniform injection — no scope/stage filter on the grounding loop
- [ ] TC-010 Injection budget ~380 tokens; revisit above ~1,000 — VR-008
- [ ] TC-011 Nothing named "cascade" — `gwrk-cascade-sync` collision (§0.5)
- [ ] TC-012 Builtins ship through `npm run build`; real `gwrk` runs `dist/` — VR-001
- [ ] TC-013 No option collisions; baseline stays nine; **no allowlist entry** (that is how D1 shipped)
- [ ] TC-014 Bare-clone operable — no SQLite, no build server
- [ ] TC-015 No lock manager — an atomic `.ADR-NNN.claim` makes the second concurrent run fail loudly (plan AMBER-3)
- [ ] TC-016 Fail-open grounding, deliberately inherited; detection belongs to `--reindex --check`

## Quality Gate

- [ ] Every US maps to ≥1 FR; every FR maps to ≥1 US (12 US, 28 FR, zero orphans)
- [ ] Every FR maps to ≥1 TR in the coverage matrix (TR-015/016/017 `DEFERRED` with rationale, not gaps)
- [ ] Every acceptance-scenario **Then** clause has an executable shell assertion
- [ ] Coverage matrix includes the Tested-by-TR column with zero orphans
- [ ] Command classification present: query/generator/verifier/mutator, exit codes, error-as-navigation, `--format json`
- [ ] Error States tables present for every FR with failure modes (FR-002, FR-007, FR-014, FR-020/021, FR-023, FR-024)
- [ ] Phase boundaries preserved from source §2; Phase 1 ships alone (SC-012, VR-006)
- [ ] Cross-references recorded for 028, 014, 013, 023, 026/027, 000-build-plan and ADR-004/006/007/009; no contract conflict
- [ ] **OQ-001 recorded**: `ADR-007 §78` is a line number cited in seven live places; correct address is `§2.1`; assumption stated so implementation is unblocked
- [ ] Harness constraints captured: id-prefixed test titles, absent pre-commit hook, MPL headers by hand, test files invisible to both gates, hermetic suites
- [ ] VR-009 recorded — `gwrk ship` / daemon MUST NOT verify this feature (Phase 2 changes the payload the reviewers receive)
- [ ] VR-010 recorded — the gate lives in `task.gateScript`, not `phase.doneWhen`
- [ ] Rejected alternatives carried with their reasons: YAML frontmatter, ADR-as-requirement, `drift-detector` wiring, dispatch-time derivation, hand-maintained index, summary-only index, derived constraint, per-stage gating, approval table, full anchor retrofit, Slack surface
- [ ] Deferred work captured (OQ-002 `Superseded` status, OQ-003 scan exclusions, OQ-004 build-plan drift, OQ-005 `.gwrk/rules/`, OQ-006 D3/D1/D2)

## Notes
- Check items off as completed: `[x]`
- Items are numbered per the spec's FR-###, US-###, TR-### and TC-### identifiers
- Phases are the source's §2 boundaries: 1 Author, 2 Index and inject, 3 Amend and check, 4 Audit
- FR-006 is the one edit that closes an outstanding requirement in another spec (028 FR-011 / W4); it is a one-file hand edit and does not have to wait for Phase 3
