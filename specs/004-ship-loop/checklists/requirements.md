# Requirements Checklist: 004 Ship Loop (Rework)

## User Stories
- [ ] US-001: Ship Single Phase completes lifecycle
- [ ] US-002: Pre-flight tasks.json gate checks
- [ ] US-003: Ship All Phases sequentially
- [ ] US-004: Circuit Breaker
- [ ] US-005: Crash Recovery
- [ ] US-006: PR Creation & CI Gate
- [ ] US-007: Execution Manifest with Log Digest
- [ ] US-008: Agent Backend Config resolution
- [ ] US-009: Phase-Skip for Completed Phases
- [ ] US-010: Staging Validation
- [ ] US-011: Structured failureContext on CIRCUIT_BREAK
- [ ] US-012: Profile-Aware Build & Test Skip ⭐ **REWORK**
- [ ] US-013: Schema-Compliant Agent Initialization ⭐ **REWORK**

## Functional Requirements
- [ ] FR-001: ShipOrchestrator delegation
- [ ] FR-002: Dirty-Tree Guard
- [ ] FR-003: Pre-flight gate skip
- [ ] FR-004: State machine transitions
- [ ] FR-005: Code/UAT review loops
- [ ] FR-006: `gh pr create` and CI wait
- [ ] FR-007: Circuit breaker MAX_ITERATIONS
- [ ] FR-008: Crash recovery state persistence
- [ ] FR-009: Hierarchical config resolution
- [ ] FR-010: Machine-local runs logging
- [ ] FR-011: recordRun() to SQLite analytical ledger
- [ ] FR-012: Execution manifest output
- [ ] FR-013: Sequential shipping fallback
- [ ] FR-014: Completed phase skip
- [ ] FR-015: Agent-Native operational signal wrapper
- [ ] FR-016: validate-staging.sh scope checking
- [ ] FR-017: 3-tier logging
- [ ] FR-018: failureContext writing
- [ ] FR-019: dispatchToAgent() facade
- [ ] FR-020: Exit code normalization
- [ ] FR-021: Context delivery via stdin piping
- [x] FR-022: Mapped build command skip/execution (getBuildCommand — 021-polyglot-toolchain / ADR-005 §11)
- [x] FR-023: Mapped test command skip/execution (getTestCommand → null — 021-polyglot-toolchain / ADR-005 §11)
- [x] FR-024: GwrkConfigSchema build/test + extensions (ToolchainConfigSchema — 021-polyglot-toolchain / ADR-005 §11)
- [ ] FR-025: Schema-compliant agent config generation ⭐ **REWORK** (not in 021 scope)

## Technical Constraints
- [ ] TC-001: Air-Gapped
- [ ] TC-002: Fail-Fast Config
- [ ] TC-003: TypeScript Only
- [ ] TC-004: Non-interactive execution

## Data Model
- [ ] DM-001: ShipState file schema
- [ ] DM-003: .gwrkrc.json schema extensions
- [ ] DM-005: ExecutionManifest schema

## Tests
- [ ] TR-001: Single phase ship E2E test
- [ ] TR-002: Dirty working tree check test
- [ ] TR-003: Pre-flight task skip check test
- [ ] TR-004: State machine transition assertions
- [ ] TR-005: Review NO-GO loops E2E test
- [ ] TR-006: PR + CI wait E2E test
- [ ] TR-007: Circuit breaker unit tests
- [ ] TR-008: Crash recovery unit tests
- [ ] TR-009: Hierarchical agent resolution unit test
- [ ] TR-010: Local runs logging E2E test
- [ ] TR-011: Runs SQLite recording unit test
- [ ] TR-012: Manifest and digest unit test
- [ ] TR-013: Sequential ship unit test
- [ ] TR-014: Completed phase skip unit test
- [ ] TR-015: Agent-Native wrapper exit code test
- [ ] TR-016: Staging validation file out-of-scope test
- [ ] TR-017: Logging format E2E test
- [ ] TR-018: Circuit break failureContext JSON test
- [ ] TR-019: dispatchToAgent facade unit test
- [ ] TR-020: Exit code normalization unit test
- [ ] TR-021: Context piping via stdin unit test
- [ ] TR-022: getBuildCommand mapping unit test ⭐ **REWORK**
- [ ] TR-023: Build/Test stages skip orchestrator unit test ⭐ **REWORK**
- [ ] TR-024: GwrkConfigSchema validation unit test ⭐ **REWORK**
- [ ] TR-025: Schema-compliant agent init unit test ⭐ **REWORK**
