---
type: contract
feature: 004-ship-loop
last_modified: "2026-03-09T22:00:00Z"
---

# Contract: Branch Management

**Feature**: 004-ship-loop
**Scope**: Git branch creation, checkout, and push for feature isolation

---

## `wud-branch.sh <feature> [push]`

**Source**: `scripts/dev/wud-branch.sh`
**Consumed by**: `scripts/dev/work-until-done.sh` (BRANCH_SETUP stage)

Ensures the correct `feat/<feature>` branch exists and is checked out. Creates from `develop` if it doesn't exist. Optionally pushes to origin.

### Arguments
| Argument | Type | Required | Description |
|---|---|---|---|
| `feature` | `string` | ✅ | Feature name, e.g. `004-ship-loop` |
| `push` | `string` | ❌ | If `"push"`, pushes branch to origin after checkout |

### Behavior
| Current Branch State | Action |
|---|---|
| Already on `feat/<feature>` | No-op |
| Branch exists locally | `git checkout feat/<feature>` |
| Branch exists on remote | `git checkout -b feat/<feature> origin/feat/<feature>` |
| Branch doesn't exist | `git checkout -b feat/<feature> develop` |

### Exit Codes
| Code | Meaning |
|---|---|
| `0` | On correct branch |
| `1` | Error (git failure) |
