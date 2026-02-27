# Contract: Git Manager

**Feature**: 002-build-server
**Scope**: Branch lifecycle for phase dispatch

---

## `createPhaseBranch(feature: string, phase: string): Promise<string>`

**Source**: `src/server/git-manager.ts`
**Consumed by**: `src/server/dispatch.ts`

Creates a `phase/<feature>-<phase>` branch from `feature/<feature>-wip`. The feature branch must exist. Returns the branch name.

```typescript
async function createPhaseBranch(feature: string, phase: string): Promise<string>
```

| Parameter | Type | Example |
|---|---|---|
| `feature` | `string` | `"001-cli-core"` |
| `phase` | `string` | `"phase-01"` |

**Returns**: `"phase/001-cli-core-phase-01"`

**Error states**:
| Condition | Throws |
|---|---|
| Feature branch not found | `GitError('Branch feature/001-cli-core-wip not found')` |
| Dirty working tree | `GitError('Working tree has uncommitted changes')` |

Implementation: `git checkout -b phase/<feature>-<phase> feature/<feature>-wip` via `child_process.execFile`.

---

## `mergePhaseBack(feature: string, phase: string): Promise<void>`

**Source**: `src/server/git-manager.ts`
**Consumed by**: `src/server/dispatch.ts`

Merges the phase branch back into the feature branch. On conflict, throws with the list of conflicting files.

```typescript
async function mergePhaseBack(feature: string, phase: string): Promise<void>
```

**Error states**:
| Condition | Throws |
|---|---|
| Merge conflict | `GitError('Merge conflict in phase/...: <files>')` |
| Branch does not exist | `GitError('Branch phase/... not found')` |

---

## `isClean(cwd: string): Promise<boolean>`

**Source**: `src/server/git-manager.ts`
**Consumed by**: `src/server/dispatch.ts`

Returns `true` if the working tree at `cwd` has no uncommitted changes. Uses `git status --porcelain`.

---

## `hasConflicts(feature: string, phase: string): Promise<boolean>`

**Source**: `src/server/git-manager.ts`
**Consumed by**: `src/server/dispatch.ts`

Dry-run merge check without actually merging. Returns `true` if merge would conflict.
