---
type: contract
feature: 004-ship-loop
last_modified: "2026-03-09T22:00:00Z"
---

# Contract: Ship Command

**Feature**: 004-ship-loop
**Scope**: Full autonomous shipping lifecycle — `gwrk ship <feature> [phase]`

---

## `gwrk ship <feature> [phase]`

**Source**: `src/commands/ship.ts` (TS wrapper) → `scripts/dev/work-until-done.sh` (state machine)
**Consumed by**: CLI

Orchestrates the full ship lifecycle. Delegates to `work-until-done.sh` for the state machine. The TS layer adds SQLite recording, execution manifests (ADR-003), and CLI UX.

### Arguments
| Argument | Type | Required | Description |
|---|---|---|---|
| `feature` | `string` | ✅ | Feature ID, e.g. `004-ship-loop` |
| `phase` | `string` | ❌ | Phase number. Omit to ship all phases. |

### Options
| Option | Type | Default | Description |
|---|---|---|---|
| `--max-iterations` | `number` | `3` | Max implement→review cycles before circuit breaker |
| `--ci-timeout` | `number` | `30` | CI wait timeout in minutes |
| `--agent` | `string` | from `.gwrkrc.json` | Override agent backend |
| `--dry-run` | `boolean` | `false` | Print invocations without executing |

---

## `shipPhase(feature, phase, backend, opts, cwd): Promise<number>`

**Source**: `src/commands/ship.ts`
**Consumed by**: Internal to `shipCommand` action

Ships a single phase through the full lifecycle. Returns exit code (0 = success).

```typescript
async function shipPhase(
  feature: string,
  phase: string,
  backend: string,
  opts: Record<string, string | boolean | undefined>,
  cwd: string,
): Promise<number>
```

---

## State Machine (work-until-done.sh)

```
BRANCH_SETUP → IMPLEMENT → CODE_REVIEW → UAT_REVIEW → PR_CI → DONE
                    ↑               |              |          |
                    └───────────────┘──────────────┘──────────┘
                         (on NO-GO: loop back, increment iteration)
                         (on CIRCUIT_BREAK: exit with code 1)
```

### Environment Variables
| Variable | Default | Description |
|---|---|---|
| `APPROVAL_MODE` | — | Set to `yolo` for autonomous execution |
| `MAX_ITERATIONS` | `3` | Circuit breaker threshold |
| `CI_TIMEOUT` | `30` | CI wait timeout in minutes |
| `AGENT_BACKEND` | from config | Agent to dispatch |
