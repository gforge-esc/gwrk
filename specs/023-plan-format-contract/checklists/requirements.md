# Requirements Checklist: 023-plan-format-contract

## User Stories

- [ ] US-001 Fenced-bash Done-When compiles to an executable gate (P0)
- [ ] US-002 Em-dash file lines are extracted (P0)
- [ ] US-003 Type-flexible Test Strategy targets are parsed (P1)
- [ ] US-004 Existing plans still parse — backward compatibility (P0)
- [ ] US-005 Generator emits the canonical format (P1)
- [ ] US-006 `define` fails loudly on a stub gate (P0)

## Functional Requirements

- [ ] FR-001 Parser captures fenced-bash Done-When → executable gate (US-001)
- [ ] FR-002 Parser extracts em-dash file lines, action ∈ {create, amend, delete} (US-002)
- [ ] FR-003 Parser reads Type-flexible Test Strategy table → `phase.testTargets` (US-003)
- [ ] FR-004 Parser stays backward-compatible with ####+prose-bullet + paren-form (US-004)
- [ ] FR-005 `gwrk-plan/PROMPT.md` emits the canonical format (US-005)
- [ ] FR-006 `define plan` self-validation fails loudly on a source-bearing stub gate (US-006)

## Testing Requirements

- [ ] TR-001 fenced-bash Done-When → verbatim gate (FR-001)
- [ ] TR-002 em-dash file lines parse; phase does not collapse (FR-002)
- [ ] TR-003 bracketed `[integration]` Type + backticked target → testTargets (FR-003)
- [ ] TR-004 golden regression: existing ####+bullet plan snapshot unchanged (FR-004)
- [ ] TR-005 validator exits 1 + names phase on stub; 0 on executable gates (FR-006)
- [ ] TR-006 generator prompt documents canonical format (FR-005)
- [ ] TR-007 SEAM: data-dashboard 002-metric-model phase-03 case (FR-001/FR-006)
- [ ] TR-008 all 13 existing plans parse with no new stub regression (FR-004/TC-004)

## Quality Gate

- [ ] Every US maps to ≥1 FR; every FR maps to ≥1 US (no orphans)
- [ ] Every FR maps to ≥1 TR in the coverage matrix
- [ ] Every acceptance-scenario Then clause has an executable shell assertion
- [ ] Error States defined for FR-002 and FR-006
- [ ] TC-001/002/003 present; feature-specific TC-004 (backward compat) + TC-005 (deterministic parser) present
- [ ] Coverage matrix includes the Tested-by-TR column with zero orphans
- [ ] Modified command (`gwrk define plan`) has type classification, exit codes, error-as-navigation, `--format json` note
- [ ] Cross-references to 021 FR-005/FR-009 recorded; no contract conflict
