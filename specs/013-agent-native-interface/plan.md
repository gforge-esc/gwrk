---
type: implementation_plan
feature: 013-agent-native-interface
last_modified: "2026-06-02T17:30:00Z"
revision: 2
---

# Implementation Plan: 013 Agent-Native Interface

**Branch**: `develop` | **Revised**: 2026-06-02 | **Spec**: [spec.md](./spec.md)
**Decision**: [ADR-004](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-004-agent-native-output.md)
**Reference**: [agent-native-cli.md](file:///Users/gonzo/Code/gwrk/docs/reference/agent-native-cli.md)
**Dependencies**: Feature 001 (CLI Core) — ✅ Complete

## Summary

Make gwrk a dual-mode CLI that operates identically for humans and LLM agents, with structured output, operational signals, project discovery, and a presentation layer that protects agents from context corruption.

> **Status**: All 3 phases **implemented and tested**. 7/9 FRs fully shipped, FR-004/FR-005 partial (discover engine exists but `gwrk project discover/specs/gates` subcommands not wired as CLI — functionality absorbed by `scanReadiness` and `gwrk gate`).

---

### Phase 1: Foundation ✅

Zero breaking changes. Pure additions to existing CLI. (7 SP)

**Files (6):**
- `src/utils/signal.ts` (NEW: `withSignal()` HOF — times execution via `performance.now()`, emits `[exit:N | Xs]` to stderr, catches all errors)
- `src/utils/signal.test.ts` (NEW: TR-001 — unit tests for signal formatting, stderr-only output, duration thresholds)
- `src/utils/output.ts` (NEW: `CommandOutput` interface, `createOutput()` factory — text mode writes to stdout, json mode emits `JSON.stringify`, `info()` always to stderr)
- `src/utils/output.test.ts` (NEW: TR-002 — text/json mode, stderr routing)
- `src/commands/gate.ts` (NEW: `gwrk gate <task_id>` — resolves gate script path, executes, captures exit code + stdout + stderr, returns `GateCheckResult` DM-002. Spec called for `gate-check`, shipped as `gate`)
- `src/commands/gate.test.ts` (NEW: TR-005 — PASS/FAIL, JSON output, error-as-navigation on missing script)

**Modifications:**
- All `src/commands/*.ts` — wrapped every `.action()` with `withSignal()` (25/25 command files)
- `src/cli.ts` — added `program.option('--format <type>', 'Output format (json)')` global flag
- `src/commands/tasks.ts`, `status.ts`, `runs.ts`, `ship.ts`, `plugin.ts`, `server.ts`, `project-info.ts` — retrofitted for `CommandOutput` / `resolveFormat()`
- Exit codes standardized: 0=success, 1=expected failure, 2=usage error, 127=unknown command

**Gates:**
- `gwrk status 2>/dev/null` produces clean stdout ✅
- `gwrk status 2>&1 >/dev/null | grep 'exit:'` — signal present ✅
- `gwrk tasks list --format json | jq .` — valid JSON ✅
- `gwrk nonexistent-command; echo $?` → 127 ✅

---

### Phase 2: Discovery ✅

Non-breaking additions. Project discovery surface. (10 SP)

**Files (4):**
- `src/engine/discover.ts` (NEW: 212 lines — `discoverProject(root)` assembles `ProjectDiscovery` DM-001 from git + filesystem only, no SQLite/server. Used by `define plan` for stdin context piping)
- `src/engine/discover.test.ts` (NEW: TR-004 — mock filesystem, verify schema, verify no sqlite/http calls)
- `src/commands/project.ts` (NEW: parent command group for `project` subcommands)
- `src/commands/project-info.ts` (NEW: `gwrk project info` — project profile auto-detection)

**Modifications:**
- All `src/commands/*.ts` — help text rewritten with command type (query/mutator), exit codes, `--format json` documentation, Examples sections (23 commands)
- All error paths — 27 instances of `Run '...'` corrective guidance added across command files

**Partial:**
- `gwrk project discover` engine exists but CLI subcommand not registered (functionality available via `define plan` stdin piping)
- `gwrk project specs` / `gwrk project gates` not registered as standalone subcommands (replaced by `scanReadiness` and `gwrk gate`)

**Gates:**
- `gwrk ship --help | grep 'Exit codes'` — enriched help ✅
- `gwrk tasks list nonexistent 2>&1 | grep "Run '"` — error navigation ✅

---

### Phase 3: Agent Mode ✅

Full Layer 2 activation. Pipe composition. Classification. (11 SP)

**Files (4):**
- `src/utils/agent-layer.ts` (NEW: 89 lines — `stripAnsi()`, `guardBinary()`, `truncateOverflow()` Layer 2 protections)
- `src/utils/agent-layer.test.ts` (NEW: TR-003 — 12 tests, ANSI removal, binary detection, overflow truncation with file reference)
- `src/engine/classify.ts` (NEW: task classification inference — `greenfield`/`change`/`refactor`/`noop` based on file existence)
- `src/engine/classify.test.ts` (NEW: 6 tests, classification logic verification)

**Modifications:**
- `src/cli.ts` — added `--agent` flag / `GWRK_AGENT=1` env support, activates Layer 2 protections independently from `--format`
- `src/commands/define-plan.ts` — stdin acceptance for discovery JSON pipe composition (`gwrk project discover --format json | gwrk define plan 001`)
- `src/utils/state.ts` — `PhaseSchema` enriched with optional `objective`, `scope`, `classification_summary`, `inputs` fields (non-breaking)

**Gates:**
- `GWRK_AGENT=1 gwrk status | cat -v | grep -c '\^\\['` → 0 (no ANSI escapes) ✅
- Existing tests pass with schema enrichment ✅

---

## Verification Plan

### Automated Tests

```bash
# Unit tests (42 passing)
pnpm vitest run src/utils/signal.test.ts       # 9 tests
pnpm vitest run src/utils/output.test.ts       # 9 tests
pnpm vitest run src/utils/agent-layer.test.ts  # 12 tests
pnpm vitest run src/engine/discover.test.ts    # 1 test
pnpm vitest run src/engine/classify.test.ts    # 6 tests
```

### E2E Verification

```bash
gwrk status 2>/dev/null                    # clean stdout
gwrk status 2>&1 >/dev/null | grep 'exit:' # signal present
gwrk tasks list --format json | jq .       # valid JSON
gwrk gate T001 --format json | jq .        # structured gate result
gwrk ship --help | grep 'Exit codes'       # enriched help
gwrk nonexistent-command; echo $?          # exit 127
```

---

## Queryable Command Table

| Command | Queryable | JSON Schema |
|---|---|---|
| `gwrk tasks list` | ✅ | `{ tasks: Task[] }` |
| `gwrk tasks next` | ✅ | `{ task: Task \| null }` |
| `gwrk tasks ready` | ✅ | `{ tasks: Task[] }` |
| `gwrk status` | ✅ | `{ project, specs, agents }` |
| `gwrk gate` | ✅ | `GateCheckResult` (DM-002) |
| `gwrk db runs` | ✅ | `{ runs: Run[] }` |
| `gwrk measure effort` | ✅ | `EffortReport` |
| `gwrk measure compression` | ✅ | `CompressionReport` |
| `gwrk define spec` | ❌ | Agent dispatch — no structured output |
| `gwrk define plan` | ❌ | Agent dispatch — no structured output |
| `gwrk ship` | ❌ | Long-running agent loop |
| `gwrk server start/stop` | ❌ | Lifecycle — status reported via signal |
| `gwrk init` | ❌ | Provisioning — status reported via signal |

---

## Wave Summary

| Phase | SP | New Files | Modified Files | Status |
|---|---|---|---|---|
| Phase 1 — Foundation | 7 | `signal.ts`, `output.ts`, `gate.ts` + tests | All commands, `cli.ts` | ✅ SHIPPED |
| Phase 2 — Discovery | 10 | `discover.ts`, `project.ts`, `project-info.ts` + tests | All help text, all error paths | ✅ SHIPPED (partial: discover/specs/gates subcommands not wired) |
| Phase 3 — Agent Mode | 11 | `agent-layer.ts`, `classify.ts` + tests | `define-plan.ts`, `state.ts`, `cli.ts` | ✅ SHIPPED |
| **Total** | **28** | **8 new files** | **~20 modified** | **SHIPPED** |

---

## Build Plan Integration

```
F001 ✅ → F013 ✅ (Agent-Native) → F004 ✅ (Ship Loop)
                                 → F008 ✅ (Agent Router)
                                 → F014 ✅ (Plugin System)
```
