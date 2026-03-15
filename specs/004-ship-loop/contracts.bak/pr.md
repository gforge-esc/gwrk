---
type: contract
feature: 004-ship-loop
last_modified: "2026-03-09T22:00:00Z"
---

# Contract: PR & CI Gate

**Feature**: 004-ship-loop
**Scope**: GitHub PR creation and CI check waiting

---

## PR Creation (work-until-done.sh PR_CI stage)

**Source**: `scripts/dev/work-until-done.sh` (inline `gh pr create`)
**Consumed by**: PR_CI stage of state machine

Creates a PR targeting `develop` from the current `feat/<feature>` branch.

```bash
gh pr create --base develop --head "feat/${FEATURE}" \
  --title "feat: ${FEATURE} phase ${PHASE}" \
  --body "$(generate_pr_body)"
```

---

## `wud-ci-wait.sh <pr_number> [timeout_minutes]`

**Source**: `scripts/dev/wud-ci-wait.sh`
**Consumed by**: `scripts/dev/work-until-done.sh` (PR_CI stage, after PR creation)

Waits for all PR checks to pass using `gh pr checks --watch`.

### Arguments
| Argument | Type | Required | Default | Description |
|---|---|---|---|---|
| `pr_number` | `number` | ✅ | — | GitHub PR number |
| `timeout_minutes` | `number` | ❌ | `30` | Max wait time |

### Exit Codes
| Code | Meaning |
|---|---|
| `0` | All checks passed |
| `1` | One or more checks failed |
| `2` | Timeout or error |

### Edge Cases
- No `.github/workflows/` directory → treated as PASS (early scaffolding)
- `gh` CLI not found → exit 2 with error message

### Dependencies
- `gh` CLI must be installed and authenticated
