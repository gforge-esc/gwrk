# Requirements Checklist: 024-gate-assertion-contract

**Purpose**: Verify the gate-assertion-contract spec is complete, traceable, and free of orphans before planning.
**Created**: 2026-07-24
**Feature**: [spec.md](../spec.md)

## User Stories

- [ ] US-001 Generator emits exit-based Done-When assertions (P0)
- [ ] US-002 The output-as-pass antipattern is forbidden in generated plans (P0)
- [ ] US-003 `define plan` rejects the antipattern in generated plans (P1)

## Functional Requirements

- [ ] FR-001 `gwrk-plan/PROMPT.md` requires Done-When lines to assert on command exit codes (US-001)
- [ ] FR-002 `gwrk-plan/PROMPT.md` forbids `<cmd> | grep -q` output-as-pass; documents why + safe alternative (US-002)
- [ ] FR-003 `define plan` lint (`plan-gate-validator.ts`) exits 1 + names phase/line on the antipattern (US-003)

## Testing Requirements

- [ ] TR-001 doc-contract: prompt requires exit-based assertion (FR-001)
- [ ] TR-002 doc-contract: prompt names/forbids `| grep -q`, states reason + capture-to-file alternative (FR-002)
- [ ] TR-003 POSITIVE: lint rejects `make test:db 2>&1 | grep -q 'db/definitions'`, names phase + line (FR-003)
- [ ] TR-004 NEGATIVE: lint passes exit-based (`make test:db`) and file-grep (`grep -q x file`) (FR-003)
- [ ] TR-005 SEAM: data-dashboard 002 `make test:db … | grep -q` false-green rejected at define time (FR-001/FR-002/FR-003)

## Error States

- [ ] FR-003 Error States table present (output-as-pass detected → exit 1; unparseable → exit 1)

## Technical Constraints

- [ ] TC-001 Air-Gapped; TC-002 Fail-Fast; TC-003 TypeScript-Only present
- [ ] TC-004 Deterministic lint (regex/string, LLM-free)
- [ ] TC-005 Execution layer unchanged (`gate.ts`/`set -e`/no-`pipefail` untouched) — verified by VR-005

## Quality Gate

- [ ] Every US maps to ≥1 FR; every FR maps to ≥1 US (no orphans)
- [ ] Every FR maps to ≥1 TR in the coverage matrix
- [ ] Every acceptance-scenario Then clause has an executable shell assertion
- [ ] Coverage matrix includes the Tested-by-TR column with zero orphans
- [ ] Modified command (`gwrk define plan`) has type classification, exit codes, error-as-navigation, `--format json` note
- [ ] Cross-references to 023 §13 (tracked follow-up) and PR #150 recorded; no contract conflict
- [ ] Layering is explicit: 023 (extraction) → PR #150 (execution) → 024 (assertion)

## Notes
- Check items off as completed: `[x]`
- Items are numbered per the spec's FR-###, US-###, and TR-### identifiers
- Authoritative source: [023 §13](../../023-plan-format-contract/spec.md) — the "assertion layer" follow-up 024 implements
