# Contract: wud-branch.sh — Branch Management

**Source**: `scripts/dev/wud-branch.sh`
**FRs**: FR-002

## Interface

```
./scripts/dev/wud-branch.sh <feature> [push]
```

**Exit codes**:
| Code | Meaning |
|---|---|
| 0 | On correct branch (created or already existed, or pushed) |
| 1 | Error (dirty tree, branch creation failed, merge conflict) |

## Behaviors

### Branch Resolution (IMPLEMENTED)

1. If already on `feat/<feature>` → log `✓ Already on` → exit 0
2. If `refs/heads/feat/<feature>` exists locally → `git checkout feat/<feature>`
3. If `origin/feat/<feature>` exists remotely → `git checkout -b feat/<feature> origin/feat/<feature>`
4. Else → `git checkout -b feat/<feature> develop`

### Push Action (IMPLEMENTED)

When `$2 == "push"` → `git push origin feat/<feature> --force-with-lease` with retry.

### Dirty-Tree Guard (FR-002) — fail-fast (IMPLEMENTED)

Before any branch operation, the script MUST:

1. Run `git status --porcelain`
2. If output is non-empty → emit to stderr: `Dirty working tree — commit or stash before shipping`
3. Exit 1

**This check currently does not exist in `wud-branch.sh`.** The spec mandates it at FR-002.

## Error States (from spec FR-002)

| Condition | stderr contains | Exit code |
|---|---|---|
| Dirty working tree | `Dirty working tree — commit or stash before shipping` | 1 |
| Branch creation failed | `Failed to create feature branch` | 1 |
| Sync produces merge conflict | `Conflict during develop sync — resolve manually` | 1 |
