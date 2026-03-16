# Contract: Tasks Generate — `gwrk define tasks`

**Source**: `src/commands/tasks-generate.ts`
**Spec**: FR-002, ADR-005
**Command Classification**: `generator` (ADR-004 §2.5)

## Command Signature

```
gwrk define tasks <feature> [--force] [--reconcile] [--no-llm]
```

## Behavior

### Gate Authoring Flow (default)

```
1. Parse plan.md → phases + tasks
2. Write tasks.json (deterministic, TypeScript)
3. Contracts guard → exit 1 if contracts/ missing
4. generateGateBrief() → /tmp/gwrk-gate-brief-<ts>.json
5. dispatchAgent() → author-gates workflow → gates/*.sh
6. generateRunner() → gates/run-all-gates.sh
```

### Contracts Guard (ADR-005 §2.1)

| Condition | Exit Code | stderr |
|---|---|---|
| `contracts/` exists with ≥1 `.md` file | Continue | — |
| `contracts/` missing | 1 | `Contracts required for gate authoring. Run 'gwrk define plan <feature>' first.` |
| `contracts/` exists but empty | 1 | Same as above |

### `--no-llm` Flag

Skips steps 3–6. Writes `tasks.json` only. No gates generated. Explicit absence.

| Flag | tasks.json | gates/ | Agent dispatch |
|---|---|---|---|
| (default) | ✅ Written | ✅ Authored by LLM | ✅ Yes |
| `--no-llm` | ✅ Written | ❌ Skipped | ❌ No |
| `--force` | ✅ Overwritten | ✅ Re-authored (preserves `# AUTHORED`) | ✅ Yes |
| `--reconcile` | ✅ Merged | ✅ Authored + audited against reality | ✅ Yes |

### Agent Dispatch (ADR-004 pattern from `plan.ts`)

```typescript
const result = await dispatchAgent({
  backend: config.agents.define,
  workflowPath: ".agents/workflows/author-gates.md",
  featureDir: relativeFeatureDir,
  contextPath: briefPath,
});
```

- Execution ledger: `startRun()` before dispatch, `finishRun()` after
- Command logged as `"define tasks:gates"`
- Workflow: `author-gates`

### Error States

| Condition | Exit Code | stderr |
|---|---|---|
| `tasks.json` exists without `--force`/`--reconcile` | 1 | `tasks.json already exists for <feature>` |
| Contracts missing | 1 | See contracts guard above |
| Agent dispatch fails | 1 | `Gate authoring failed (exit N). See <logPath>` |
| `plan.md` missing | 1 | Thrown by `parsePlan()` |

### Exit Code Contract (ADR-004 §2.2)

| Code | Meaning |
|---|---|
| 0 | Success: tasks.json + gates generated |
| 1 | Expected failure: missing contracts, agent failed, tasks.json exists |
| 2 | Usage error: bad arguments |

## Reconcile Mode Audit

In `--reconcile` mode, after gates are authored, each gate for an `open` task is executed:
- If gate passes → task status set to `completed`
- If gate fails → task stays `open`
- Re-saves `tasks.json` with updated statuses
