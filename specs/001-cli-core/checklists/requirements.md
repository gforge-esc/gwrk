# Requirements Checklist: 001 CLI Core

## User Stories
- [ ] US-001: Project Initialization (`gwrk init`)
- [ ] US-002: Agent Specification (`gwrk specify`)
- [ ] US-003: Agent Planning (`gwrk plan`)
- [ ] US-004: Task Decomposition (`gwrk tasks generate`)
- [ ] US-005: Task State Query (`gwrk tasks list`, `gwrk tasks next`)
- [ ] US-006: Hard Gate Enforcement (`gwrk tasks done`)
- [ ] US-007: Status Transition History (`.gwrk/history.jsonl`)
- [ ] US-008: Configuration Validation (`.gwrkrc.json` + Zod)
- [ ] US-009: Agent Cross-Artifact Analysis (`gwrk analyze`)
- [ ] US-010: Effort Estimation (`gwrk effort`)

## Functional Requirements
- [ ] FR-001: `gwrk init` scaffolds project structure
- [ ] FR-002: `gwrk specify` dispatches agent with `/specify` workflow
- [ ] FR-003: `gwrk plan` dispatches agent with `/plan` workflow
- [ ] FR-004: `gwrk tasks generate` parses plan.md → tasks.json + gates/
- [ ] FR-005: `gwrk tasks list` and `gwrk tasks next` query task state
- [ ] FR-006: `gwrk tasks done` executes gate before state mutation
- [ ] FR-007: History log append on every state transition
- [ ] FR-008: Zod-validated `.gwrkrc.json` with fail-fast
- [ ] FR-009: `gwrk analyze` dispatches `/analyze` workflow
- [ ] FR-010: `gwrk effort` dispatches `/effort` workflow

## Technical Constraints
- [ ] TC-001: Sequential task IDs (T001, T002), no UUIDs
- [ ] TC-002: Air-gapped — CLI makes no network calls
- [ ] TC-003: Fail-fast config — no `.default()` calls
- [ ] TC-004: Hard gates — only `gwrk tasks done` can mutate state
- [ ] TC-005: TypeScript only — no `.js` in `src/`
- [ ] TC-006: ESM modules — ES2022 target
- [ ] TC-007: Branch-scoped state — tasks.json follows branch

## Data Model
- [ ] DM-001: tasks.json schema (TaskState → Phase[] → Task[])
- [ ] DM-002: history.jsonl schema (HistoryEntry)
- [ ] DM-003: .gwrkrc.json schema (GwrkConfig)

## Tests
- [ ] TR-001: init command tests
- [ ] TR-002: specify command tests
- [ ] TR-003: plan command tests
- [ ] TR-004: tasks generate tests
- [ ] TR-005: tasks query tests
- [ ] TR-006: tasks done tests
- [ ] TR-007: state utility tests
- [ ] TR-008: config validation tests
- [ ] TR-009: analyze command tests
- [ ] TR-010: effort command tests

## Verification
- [ ] VR-001: E2E integration test (init → generate → done)
- [ ] VR-002: Negative test (failing gate → state unchanged)
- [ ] VR-003: Config validation crash test
