# Requirements Checklist: 007 Effort + Compression

## User Stories
- [ ] US-001: Effort Estimation for a Single Feature (`gwrk measure effort <feature>`)
- [ ] US-002: Effort Report Handles Missing Spec (fail-fast)
- [ ] US-003: Single Feature Compression Report (`gwrk measure compression <feature>`)
- [ ] US-004: Active Coding Detection via Commit Clustering
- [ ] US-005: Cross-Feature Compression Summary (`gwrk measure compression --all`)
- [ ] US-006: Compression Handles Unshipped Features (fail-fast)
- [ ] US-007: JSON Output Mode (`--json`)
- [ ] US-008: Role Multiplier Configuration (`.gwrkrc.json`)
- [ ] US-009: Persistent Compression History (SQLite)
- [ ] US-010: Leading Compression Indicators (Convergence & Density)

## Functional Requirements
- [ ] FR-001: Parse spec.md and extract user stories with SP/role
- [ ] FR-002: Compute hours with role multipliers + 1.25× overhead
- [ ] FR-003: Generate markdown effort report to `docs/assessments/`
- [ ] FR-004: Fail-fast on missing spec or no user stories
- [ ] FR-005: Collect timestamps from OS file dates + Git + GitHub
- [ ] FR-006: Detect active coding time via commit clustering (30-min gap)
- [ ] FR-007: Compute Point Compression ratio
- [ ] FR-008: Compute Total Compression ratio
- [ ] FR-009: Cross-feature compression summary with trends
- [ ] FR-010: Fail-fast on features with no impl commits
- [ ] FR-011: JSON output mode for effort and compression
- [ ] FR-012: Role multiplier overrides from `.gwrkrc.json`
- [ ] FR-013: Record results in SQLite `compression` table
- [ ] FR-014: Compute leading indicators (convergence, density, spec quality)
- [ ] FR-015: Include leading indicators in reports (CLI/JSON)

## Technical Constraints
- [ ] TC-001: Deterministic output given same inputs (SHA256 invariants)
- [ ] TC-002: Air-gapped — local Git only, `gh` degrades gracefully
- [ ] TC-003: Fail-fast config — no `.default()` calls
- [ ] TC-004: Session gap threshold configurable (no magic values)
- [ ] TC-005: Effort engine is deterministic from artifacts (no LLM)
- [ ] TC-006: Compression depends on effort data
- [ ] TC-007: Relational fidelity (SQLite schema follows ADR-002)

## Data Model
- [ ] DM-001: EffortReport schema (roles, stories, totals)
- [ ] DM-002: CompressionReport schema (forecast, actuals, ratios, indicators)
- [ ] DM-003: CompressionSummary schema (features, totals, best/worst/trend)

## Tests
- [ ] TR-001: Story extraction from spec.md
- [ ] TR-002: Role hour calculation with overhead
- [ ] TR-003: Report generation writes valid markdown
- [ ] TR-004: Fail-fast on missing spec.md
- [ ] TR-005: Timestamp collection from Git log
- [ ] TR-006: Commit clustering with gap threshold
- [ ] TR-007: Point Compression calculation
- [ ] TR-008: Total Compression calculation
- [ ] TR-009: Cross-feature summary aggregation
- [ ] TR-010: Fail-fast on no impl commits
- [ ] TR-011: Effort `--json` output validation
- [ ] TR-012: Compression `--json` output validation
- [ ] TR-013: Role multiplier override from config
- [ ] TR-014: SQLite persistence validation (compression table)
- [ ] TR-015: Leading indicator calculation validation

## Verification
- [ ] VR-001: E2E effort report generation
- [ ] VR-002: E2E compression with known timestamps
- [ ] VR-003: Negative test — missing spec.md
- [ ] VR-004: Negative test — no impl commits
- [ ] VR-005: Dormancy exclusion from compression
- [ ] VR-006: SQLite persistence (VR-006)
