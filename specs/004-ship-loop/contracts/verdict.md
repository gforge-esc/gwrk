---
type: contract
feature: 004-ship-loop
last_modified: "2026-03-09T22:00:00Z"
---

# Contract: Verdict Checker

**Feature**: 004-ship-loop
**Scope**: GO/NO-GO determination from tasks.json for a given phase

---

## `wud-verdict.sh <spec_dir> <phase_number>`

**Source**: `scripts/dev/wud-verdict.sh`
**Consumed by**: `scripts/dev/work-until-done.sh` (after CODE_REVIEW and UAT_REVIEW stages)

Reads `tasks.json` and counts open vs completed tasks for the given phase. Returns GO if all tasks are completed, NO-GO otherwise.

### Arguments
| Argument | Type | Required | Description |
|---|---|---|---|
| `spec_dir` | `string` | ✅ | Path to spec directory, e.g. `specs/004-ship-loop` |
| `phase_number` | `number` | ✅ | Phase number, e.g. `1` |

### Exit Codes
| Code | Meaning | stdout |
|---|---|---|
| `0` | GO — all tasks completed | `GO — N/N tasks complete (phase-NN)` |
| `1` | NO-GO — open tasks remain | `NO-GO — M/N tasks still open (phase-NN)` + task list |
| `2` | Error (missing file, jq unavailable) | Error message |

### Dependencies
- `jq` must be installed
- `<spec_dir>/.gwrk/tasks.json` must exist
