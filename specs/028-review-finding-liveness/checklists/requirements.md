# Requirements Checklist: 028-review-finding-liveness

**Purpose**: Verify the review-finding-liveness spec is complete, traceable, and free of orphans before planning.
**Created**: 2026-08-20
**Feature**: [spec.md](../spec.md)
**Authoritative source**: [`docs/code-review-verdict-defect.md`](../../../docs/code-review-verdict-defect.md)

## User Stories

- [ ] US-001 A code review that reproduces a blocking defect reports NO-GO (P0) — D10, D1, D9
- [ ] US-002 A re-open on a task with no `gateScript` produces NO-GO, not a vacuous GO (P0) — D2
- [ ] US-003 The earlier-phase infinite-loop guard survives the fix (P0, guard) — D10 guard
- [ ] US-004 A blocking finding survives a later agent rewriting the task description (P0) — D3
- [ ] US-005 The returned JSON verdict is a one-way ratchet (P1) — D4
- [ ] US-006 DIAGNOSE receives the review finding as error context (P1) — D5
- [ ] US-007 The doctrine is corrected wherever it is written down (P1) — D6, W4

## Functional Requirements

- [ ] FR-001 `stageCodeReview` scope context carries `VERDICT CHANNEL`; the unqualified "do NOT change its status" sentence is gone; a code comment records why (US-001) — landed `a57a68f`
- [ ] FR-002 Cross-phase guard preserved explicitly: "Do NOT touch tasks belonging to any OTHER phase" (US-003) — landed `a57a68f`
- [ ] FR-003 Both code-review prompts: MUST-flip-status contract, one-way rule, no phase-wide force-complete, no skip-to-Step-6 bypass, one-task-at-a-time completion, APPEND ONLY, corrected verdict criteria + JSON warning, inverted anti-patterns; byte-identical (US-001) — landed `a57a68f`
- [ ] FR-004 All `.phases[]` selectors use `$PHASE_ID` (zero-padded), never a bare number; CAUTION + read-back verification (US-001) — landed `a57a68f`
- [ ] FR-005 `readVerdict` consults `reopenedByReview` before any `continue`; ungated re-open → NO-GO + `REVIEW FINDING (…, no gate)` note; untouched ungated task still GO (US-002) — landed `e588d1f`
- [ ] FR-006 DIAGNOSE regex matches `REVIEW/GATE DIVERGENCE`, `REVIEW FINDING`, `REVIEW FAIL`; review-driven prompt asks for a gate or test per fix (US-006) — landed `e588d1f`
- [ ] FR-007 `readVerdict` doc comment states the real rule, not "any open task → NO-GO" (US-007) — landed `e588d1f`
- [ ] FR-008 `detectReviewReopens` diffs descriptions; a newly appended `REVIEW FAIL (` block is a finding → NO-GO regardless of status; pre-existing blocks do not re-fire (US-004) — **W3, outstanding**
- [ ] FR-009 Append-only findings store (`findings[]` on the phase or `.gwrk/findings.jsonl`); description is a mirror, not the record (US-004) — **W3, outstanding**
- [ ] FR-010 One-way JSON ratchet: returned NO-GO forces NO-GO; returned GO ignored; absent/unparseable never hard-fails (US-005) — **W3, outstanding**
- [ ] FR-011 ADR-007 §78 carries the inline `028 correction` block citing the source doc (US-007) — **W4, outstanding**

## Testing Requirements

- [ ] TR-001 D10 regression guard — `VERDICT CHANNEL` present, old sentence absent (FR-001) *(exists)*
- [ ] TR-002 GUARD — scope context still forbids touching other phases (FR-002) *(exists)*
- [ ] TR-003 PROMPT CONTRACT — new `review-prompts.test.ts`: no force-complete, one-way rule, `$PHASE_ID` selectors, read-back, APPEND ONLY, byte-identity (FR-003/FR-004) *(to author)*
- [ ] TR-004 D2 POSITIVE — ungated re-open → NO-GO, stays open, note recorded (FR-005) *(exists)*
- [ ] TR-005 D2 NEGATIVE — untouched ungated task still GO; no gate run for a gateless task (FR-005) *(exists)*
- [ ] TR-006 D5 — both note formats reach the diagnostician; no-finding open task still skips (FR-006) *(exists)*
- [ ] TR-007 DOC CONTRACT — `readVerdict` doc comment states the real rule (FR-007) *(to author)*
- [ ] TR-008 D3 DETECTION — newly appended `REVIEW FAIL (` → NO-GO on a `completed` task; pre-existing does not re-fire (FR-008) *(to author)*
- [ ] TR-009 D3 DURABILITY — new `findings-ledger.test.ts`: finding survives a description overwrite; ledger is append-only (FR-009) *(to author)*
- [ ] TR-010 D4 RATCHET — returned NO-GO forces NO-GO; returned GO loses to a re-open; absent verdict never fails the run (FR-010) *(to author)*
- [ ] TR-011 ADR CONTRACT — ADR-007 carries the `028 correction` block (FR-011) *(to author)*
- [ ] TR-012 SEAM — the runs #2727/#2728 shape end-to-end, both with and without the status flip (FR-001/FR-003/FR-005/FR-008) *(to author)*

## Error States

- [ ] FR-001/FR-002/FR-003/FR-004 agent-facing table (status flip → NO-GO; note-only → caught by FR-008; bare-number selector → caught by read-back; other-phase touch → `validatePhaseScope` fails)
- [ ] FR-005 `readVerdict` table (ungated re-open, gate-passes divergence, gate fails, untouched gateless, untouched gated)
- [ ] FR-006 DIAGNOSE table (review-driven note, build-driven note, no note)
- [ ] FR-008/FR-009 findings-channel table (new block, pre-existing block, unreadable `tasks.json`, later overwrite)
- [ ] FR-010 ratchet table (returned NO-GO, returned GO vs re-open, returned GO clean, unparseable)

## Technical Constraints

- [ ] TC-001 Air-Gapped; TC-002 Fail-Fast; TC-003 TypeScript-Only present
- [ ] TC-004 `gwrk ship` / daemon MUST NOT verify this feature (circularity, precedent #171–#176, human-only) — VR-009
- [ ] TC-005 Prompt changes go live via `postbuild`; `dist/` is shared mutable state — VR-004
- [ ] TC-006 JSON ratchet is one-way permanently; a returned GO never overrides evidence — TR-010
- [ ] TC-007 `review-code-cli` / `review-code-webapp` PROMPT.md byte-identical — TR-003, VR-005
- [ ] TC-008 Bare-clone verdict path (no SQLite, no build server) — TR-004, TR-005
- [ ] TC-009 `tasks.json` is the agent's only surviving channel (`revertSourceMutations`) — TR-008, TR-009

## Quality Gate

- [ ] Every US maps to ≥1 FR; every FR maps to ≥1 US (no orphans)
- [ ] Every FR maps to ≥1 TR in the coverage matrix
- [ ] Every acceptance-scenario Then clause has an executable shell assertion
- [ ] Coverage matrix includes the Tested-by-TR column with zero orphans
- [ ] Changed stages (CODE_REVIEW, `readVerdict`, DIAGNOSE) have type classification, exit codes, error-as-navigation, `--format json` note
- [ ] Landed-vs-outstanding status recorded per FR (W1/W2 landed; W3/W4 outstanding)
- [ ] Cross-references to the source doc, ADR-007 §78, 026, 027, the divergence regression suite, and the gate convention recorded; no contract conflict
- [ ] Must-not-regress guards explicit (FR-002 cross-phase guard; FR-005 no-false-positive; TC-006 one-way ratchet)
- [ ] Deferred work captured (OQ-001 storage choice, OQ-002 ratchet-or-delete, OQ-003 W8/D7, OQ-004 audit, OQ-005 build-plan drift)
- [ ] VR-008 gate sanity check recorded — the phase gate lives in `task.gateScript`, not `phase.doneWhen`

## Notes
- Check items off as completed: `[x]`
- Items are numbered per the spec's FR-###, US-###, and TR-### identifiers
- FR-001…FR-007 describe behaviour already on `develop` (PR #176 / `5cd80cb`); they are stated normatively so the rule is testable, not merely historical
