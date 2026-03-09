---
type: contract
feature: 004-ship-loop
last_modified: "2026-03-05T11:12:20Z"
---

# Contract: Branch Management

**Feature**: 004-ship-loop
**Scope**: Git branch creation, checkout, and develop merge for feature work

---

## `ensureBranch(featureName: string): Promise<string>`

**Source**: `src/utils/branch.ts`
**Consumed by**: `src/commands/implement.ts`

Creates `feat/<featureName>` from `develop` if it doesn't exist. If it exists locally, checks it out and merges latest `develop`. If it exists only on remote, tracks it. Returns the branch name.

```typescript
function ensureBranch(featureName: string): Promise<string>
```

| Parameter | Type | Description |
|---|---|---|
| `featureName` | `string` | Feature identifier, e.g. `004-ship-loop` |

**Returns**: Branch name (e.g. `feat/004-ship-loop`)

**Behavior**:
1. If current branch is already `feat/<featureName>`: no-op, return branch name.
2. If local branch exists: `git checkout feat/<featureName>` → `git merge develop --no-edit`.
3. If remote branch exists: `git checkout -b feat/<featureName> origin/feat/<featureName>` → merge develop.
4. If neither: `git checkout develop` → `git pull` → `git checkout -b feat/<featureName>`.

---

## `pushBranch(featureName: string): Promise<void>`

**Source**: `src/utils/branch.ts`
**Consumed by**: `src/commands/wud.ts`

Pushes `feat/<featureName>` to origin with `--force-with-lease`. Retries once on failure with pull --rebase.

```typescript
function pushBranch(featureName: string): Promise<void>
```
