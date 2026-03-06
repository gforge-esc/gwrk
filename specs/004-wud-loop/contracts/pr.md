---
type: contract
feature: 004-wud-loop
last_modified: "2026-03-05T11:12:20Z"
---

# Contract: PR + CI Gate

**Feature**: 004-wud-loop
**Scope**: GitHub PR creation and CI check waiting

---

## `createPR(opts: CreatePROptions): Promise<number>`

**Source**: `src/utils/pr.ts`
**Consumed by**: `src/commands/wud.ts`

Creates a GitHub PR via `gh pr create` targeting `develop`. If a PR already exists for the branch, returns the existing PR number.

```typescript
interface CreatePROptions {
  featureName: string;       // e.g. "004-wud-loop"
  phaseNumber: number;
  featureDir: string;        // For reading tasks.json to build PR body
}

function createPR(opts: CreatePROptions): Promise<number>
```

| Parameter | Type | Description |
|---|---|---|
| `featureName` | `string` | Feature identifier |
| `phaseNumber` | `number` | Phase number for PR title |
| `featureDir` | `string` | Spec dir for task list in PR body |

**Returns**: PR number.
**Throws**: If `gh` CLI not found → exit 1. If PR creation fails → exit 1.

---

## `waitForCI(prNumber: number, timeoutMinutes: number): Promise<boolean>`

**Source**: `src/utils/pr.ts`
**Consumed by**: `src/commands/wud.ts`

Waits for all CI checks to pass on a PR via `gh pr checks --watch`. Returns true if all pass, false on failure or timeout.

```typescript
function waitForCI(prNumber: number, timeoutMinutes: number): Promise<boolean>
```

**Returns**: `true` = all checks passed, `false` = failure or timeout.

**Special case**: If no CI checks are reported and no `.github/workflows/` directory exists, returns `true` (early scaffolding pass-through).
