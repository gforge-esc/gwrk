---
type: gap_analysis
feature: 001-cli-core
last_modified: "2026-03-12T23:30:00Z"
---

# Gap Analysis: 001 CLI Core (Test Coverage Audit)

**Date**: 2026-03-12
**Status**: ⚠️ Partial Coverage Gaps Identified

---

## Functional Requirements Coverage

| FR-### | Requirement | Status | Test File | Gap / Notes |
|---|---|---|---|---|
| FR-001 | `gwrk init` | ✅ tested | `src/commands/init.test.ts` | Covers scaffolding, idempotency, and git repo creation. |
| FR-002 | `gwrk define spec` | ✅ tested | `src/commands/specify.test.ts` | Covers agent dispatch and exit codes. |
| FR-003 | `gwrk define plan` | ✅ tested | `src/commands/plan.test.ts` | Covers spec existence and Stub rejection. |
| FR-004 | `gwrk define tasks` | ✅ tested | `src/commands/tasks-generate.test.ts` | Covers task decomposition and gate script creation. |
| FR-005 | `gwrk tasks list/next` | ✅ tested | `src/commands/tasks-query.test.ts` | Covers JSON and human-readable output. |
| FR-006 | `gwrk tasks done` | ✅ tested | `src/commands/tasks-done.test.ts` | Covers gate enforcement and state mutation. |
| FR-007 | History.jsonl append | ✅ tested | `src/commands/tasks-done.test.ts` | Verified after successful `tasks done`. |
| FR-008 | Zod config validation | ✅ tested | `src/utils/config.test.ts` | Comprehensive schema and fail-fast tests. |
| FR-010 | `gwrk measure effort` | ✅ tested | `src/commands/effort.test.ts` | Covers report generation and JSON output. |
| FR-011 | `gwrk define <feature>` | ✅ tested | `src/commands/define.test.ts` | Covers shell passthrough and SQLite recording. |
| FR-012 | `gwrk implement` | ✅ tested | `src/commands/implement.test.ts` | Covers internal agent dispatch. |
| FR-013 | `gwrk ship <feature>` | ✅ tested | `src/commands/ship.test.ts` | Covers autonomous ship loop and pre-flight tests. |
| FR-014 | `gwrk db runs` | ✅ tested | `src/commands/runs.test.ts` | Covers run history query and JSON output. |
| FR-015 | `gwrk db stats` | ✅ tested | `src/commands/stats.test.ts` | Covers aggregate success rates. |
| FR-016 | `gwrk measure compression` | ✅ tested | `src/commands/compression.test.ts` | Covers point and total compression calculation. |
| FR-017 | `gwrk measure pulse` | ✅ tested | `src/commands/pulse.test.ts` | Covers git log scanning (shared with 006-pulse). |
| FR-018 | CLI Surface hierarchy | ✅ tested | `src/cli.test.ts` | Validates exactly the settled command hierarchy. |
| FR-019 | Execution manifest | ✅ tested | `src/utils/manifest.test.ts` | Covers manifest writer and schema. |
| FR-020 | `gwrk tasks verify` | ❌ untested | — | **Assertion missing**: No test verifies that `tasks verify` correctly reports orphaned manifests or regressed tasks. `src/commands/tasks.ts` implements it but lacks a corresponding `.test.ts`. |
| FR-022 | `gwrk setup` | ⚠️ weak | `src/commands/setup-slack.test.ts` | **Major Gap**: Only Slack setup is tested. Workstation provisioning (TCC, SSH, gh) is neither implemented in `setupCommand` nor tested. Pre-flight check in `ship.ts` is implemented but needs specific test coverage for `setup.json` missing states. |

---

## Action Plan: Testing Gaps

### 1. Implement `src/commands/tasks-verify.test.ts` (FR-020)
- **Target**: `gwrk tasks verify <feature>`
- **Assertions**:
  - Exit 0 if all completed tasks have manifests.
  - Exit 1 if a completed task is missing a manifest.
  - Exit 1 if a manifest exists for a task that is marked `open` (orphan).
  - Exit 1 if `tasks.json` schema is invalid.

### 2. Implement `src/commands/setup.test.ts` (FR-022)
- **Target**: `gwrk setup` (once workstation parts are implemented)
- **Assertions**:
  - `gh auth status` failure triggers `gh auth login`.
  - SSH key is generated at `~/.ssh/gwrk-agent`.
  - `~/.ssh/config` is updated correctly.
  - `~/.gwrk/setup.json` is written on completion.

### 3. Strengthen `src/commands/ship.test.ts` (FR-022 Pre-flight)
- **Target**: `gwrk ship` pre-flight check for setup state.
- **Assertions**:
  - Exit 1 with "Run gwrk setup first" if `~/.gwrk/setup.json` is missing.
  - Exit 1 if setup state is incomplete.
