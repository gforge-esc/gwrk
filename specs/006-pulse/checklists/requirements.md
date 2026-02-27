# Requirements Checklist: 006 Pulse

**Purpose**: Track implementation readiness for Pulse productivity dashboard
**Created**: 2026-02-27
**Feature**: [spec.md](file:///Users/gonzo/Code/gwrk/specs/006-pulse/spec.md)

## User Stories
- [ ] US-001: Current Pulse Snapshot (`gwrk pulse`)
- [ ] US-002: Historical Scan (`gwrk pulse scan [path]`)
- [ ] US-003: Published vs Draft Separation (mainLoc / draftLoc)
- [ ] US-004: Weekly LOC Buckets (time series)
- [ ] US-005: Spec Progress in Pulse output
- [ ] US-006: JSON Output Mode (`--json`)
- [ ] US-007: Performance on Large Repos (≤ 60s for 50K commits)
- [ ] US-008: Default Branch Detection (auto-detect main/master/trunk)

## Functional Requirements
- [ ] FR-001: `gwrk pulse` generates PulseSnapshot across tracked repos
- [ ] FR-002: `gwrk pulse scan [path]` walks git log of any repo
- [ ] FR-003: Published/draft LOC separation (mainLoc vs draftLoc)
- [ ] FR-004: Weekly buckets (weekStart, totalMain, totalDrafts, added, deleted)
- [ ] FR-005: Spec progress scanning (specs/*/spec.md and plan.md counts)
- [ ] FR-006: `--json` flag for structured JSON output
- [ ] FR-007: ≤ 60s scan for 50K-commit repos
- [ ] FR-008: Default branch auto-detection with fallback chain

## Technical Constraints
- [ ] TC-001: Determinism — same git history → same output
- [ ] TC-002: Air-gapped — no network calls, all data from local git
- [ ] TC-003: Fail-fast config — Zod validation of pulse.repos
- [ ] TC-004: Performance — single-pass git log parsing (`--numstat`)
- [ ] TC-005: Branch heuristic — symbolic-ref → main → master → trunk → error

## Data Model
- [ ] DM-001: PulseSnapshot (repoPath, mainLoc, draftLoc, weeklyBuckets)
- [ ] DM-002: PulseReport (repositories[], specProgress)
- [ ] DM-003: PulseConfig extension to .gwrkrc.json (pulse.repos)

## Tests
- [ ] TR-001: Git log parser unit tests (weekly buckets, LOC counts)
- [ ] TR-002: Branch separation logic unit tests (main vs draft)
- [ ] TR-003: Default branch detection unit tests (fallback chain)
- [ ] TR-004: `gwrk pulse` command unit tests (multi-repo, config reading)
- [ ] TR-005: `gwrk pulse scan` command unit tests (path validation, JSON output)
- [ ] TR-006: Error case unit tests (non-existent path, non-git repo, missing config)
- [ ] TR-007: Integration test (real git repo, 3 weeks of commits)
- [ ] TR-008: Spec progress scanning unit tests

## Verification
- [ ] VR-001: E2E: temp repo → pulse scan → verify JSON output
- [ ] VR-002: Negative: non-repo path → exit 1 + correct stderr
- [ ] VR-003: Config: missing pulse.repos → exit 1 + Zod error
- [ ] VR-004: Determinism: two runs → identical output

## Notes
- Check items off as completed: `[x]`
- Items are numbered sequentially for cross-reference
- Link findings to relevant FR-###, US-###, or TR-### identifiers
