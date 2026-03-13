# 013 Agent-Native Interface — Implementation Plan

> **Feature:** Phase 13 — Agent-Native Interface
> **Date:** 2026-03-13 · **Status:** Draft
> **Spec:** [agent-native-cli.md](file:///Users/gonzo/Code/gwrk/docs/reference/agent-native-cli.md)
> **Decision:** [ADR-004](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-004-agent-native-output.md)
> **Dependencies:** Phase 1 (CLI Core) — ✅ Complete

---

## Objective

Make gwrk a dual-mode CLI that operates identically for humans and LLM agents, with structured output, operational signals, project discovery, and a presentation layer that protects agents from context corruption.

---

## Phase 1 — Foundation (7 SP)

Zero breaking changes. Pure additions to existing CLI.

### 1.1 Operational Signal Wrapper (2 SP)

#### [NEW] `src/utils/signal.ts`

`withSignal()` higher-order function wrapping every Commander action:

```typescript
export async function withSignal(name: string, fn: () => Promise<void>): Promise<never>;
```

- Times execution via `performance.now()`
- Emits `[exit:0 | 42ms]` or `[exit:1 | 3.2s] name: error message` to stderr
- Catches all errors, never lets unhandled rejections escape
- Duration formatting: `<1s → Nms`, `≥1s → N.Ns`

#### [MODIFY] All `src/commands/*.ts`

Wrap every Commander `.action()` callback with `withSignal()`:

```diff
-  .action(async (feature, options) => {
-    // ... existing logic ...
-  })
+  .action(async (feature, options) => {
+    await withSignal('define plan', async () => {
+      // ... existing logic (unchanged) ...
+    });
+  })
```

Files affected: `define.ts`, `ship.ts`, `test.ts`, `measure.ts`, `tasks.ts`, `db.ts`, `server.ts`, `status.ts`, `init.ts`, `setup-slack.ts`

**Gate:** `gwrk status 2>/dev/null` produces clean stdout. `gwrk status 2>&1 >/dev/null` contains `[exit:0 |`.

### 1.2 `--format json` Global Flag (2 SP)

#### [MODIFY] `src/cli.ts`

Add global option:

```typescript
program.option('--format <type>', 'Output format: human | json', 'human');
```

#### [NEW] `src/utils/output.ts`

Output abstraction (directly inspired by agent-clip's `output.go`):

```typescript
export interface CommandOutput {
  write(data: string | object): void;
  info(msg: string): void;  // stderr
}

export function createOutput(format: 'human' | 'json'): CommandOutput;
```

- `human` mode: `write()` → `process.stdout.write(String(data))`, `info()` → `process.stderr.write()`
- `json` mode: `write()` → `JSON.stringify(data)` to stdout, `info()` → stderr

#### [MODIFY] `src/commands/tasks.ts`, `status.ts`, `measure.ts`

Retrofit to use `CommandOutput`:
- `tasks list`: human = table, json = `{ tasks: [...] }`
- `tasks next`: human = formatted task, json = `{ task: {...} }`
- `status`: human = formatted summary, json = `{ project, specs, agents }`

**Gate:** `gwrk tasks list --format json | jq .` produces valid JSON.

### 1.3 `gwrk gate-check` Command (2 SP)

#### [NEW] `src/commands/gate-check.ts`

```typescript
export const gateCheckCommand = new Command('gate-check')
  .description('Run a gate script and return structured result')
  .argument('<task_id>', 'Task ID (e.g., T001)')
  .option('-f, --feature <dir>', 'Feature directory')
  .action(async (taskId, options) => {
    await withSignal('gate-check', async () => {
      // 1. Resolve gate script path: specs/<feature>/gates/<taskId>-gate.sh
      // 2. Execute: bash <gate-script>
      // 3. Capture exit code + stdout + stderr
      // 4. Return: { task, result: "PASS"|"FAIL", exitCode, output, duration }
    });
  });
```

**Gate:** `gwrk gate-check T001 -f specs/000-tdd-infrastructure --format json` returns valid JSON with `result` field.

### 1.4 Exit Code Standardization (1 SP)

Audit all commands. Ensure:
- 0 = success
- 1 = expected failure (gate failed, spec not found, etc.)
- 2 = usage error (missing args, invalid flags)
- No command exits with arbitrary codes

**Gate:** `gwrk nonexistent-command; echo $?` returns 127 or Commander's default.

---

## Phase 2 — Discovery (10 SP)

Non-breaking additions. Creates the project discovery surface.

### 2.1 `gwrk project discover` (5 SP)

#### [NEW] `src/commands/project.ts`

Parent command group:

```typescript
export const projectCommand = new Command('project')
  .description('Query project state');
```

#### [NEW] `src/engine/discover.ts`

Discovery engine that assembles project state from multiple sources:

| Signal | Source | Method |
|---|---|---|
| Git state | `.git/` | `git status --porcelain`, `git branch --show-current`, `git log -1` |
| Spec inventory | `specs/*/spec.md` | Glob + check for `plan.md`, `tasks.json` to determine status |
| Task state | `specs/*/.gwrk/tasks.json` | JSON parse, aggregate open/completed counts |
| Gate status | `specs/*/gates/T*-gate.sh` | Execute each, collect exit codes |
| Build health | `pnpm build` | Dry-run or cached exit code |
| Config | `.gwrkrc.json` | Zod parse via existing `loadConfig()` |

Output schema:

```typescript
interface ProjectDiscovery {
  project: { name: string; root: string; git: GitState };
  specs: SpecSummary[];
  gates: { total: number; passing: number; failing: number };
  build: { test_command: string; lint_command: string };
  config: Partial<GwrkConfig>;
}
```

**Gate:** `gwrk project discover --format json | jq .project.name` returns project name.

### 2.2 `gwrk project specs` and `gwrk project gates` (2 SP)

Subcommands of `project`:

- `specs`: List all specifications with status (`drafted | planned | tasked | shipped`)
- `gates`: Aggregate gate results grouped by feature and phase

Both support `--format json`.

**Gate:** `gwrk project specs --format json | jq '.[0].status'` returns valid status string.

### 2.3 Help Text Rewrite (2 SP)

Rewrite all `--help` text to include agent-useful information in standard text format:
- Available flags including `--format json`
- Exit code documentation
- Command type (query/generator/verifier/mutator)
- Mutation declarations where applicable

Agents discover `--format json` through `--help` like any other flag — no special metadata format needed.

**Gate:** `gwrk gate-check --help | grep -c 'format json'` returns ≥ 1.

### 2.4 Error-as-Navigation (1 SP)

Systematic error message rewrite across all commands:

```diff
-  throw new Error(`tasks.json not found`);
+  throw new Error(`tasks.json not found. Run 'gwrk define tasks <feature>' to generate. See 'gwrk define --help'.`);
```

Pattern: every error message includes:
1. What failed
2. What to do instead (command to run)
3. Where to learn more (`--help` reference)

**Gate:** `gwrk tasks list nonexistent 2>&1 | grep -c "Run '"` returns ≥ 1.

---

## Phase 3 — Agent Mode (11 SP)

Full Layer 2 activation. Pipe composition. Classification.

### 3.1 `--agent` Mode / Layer 2 (5 SP)

#### [NEW] `src/utils/agent-layer.ts`

```typescript
export function processForAgent(output: string): string {
  let result = stripAnsi(output);
  result = guardBinary(result);
  result = truncateOverflow(result, 8192);
  return result;
}

function stripAnsi(s: string): string;      // Remove ANSI escape sequences
function guardBinary(s: string): string;     // Detect null bytes / non-printable ratio
function truncateOverflow(s: string, limit: number): string; // First 100 lines + file ref
```

#### [MODIFY] `src/cli.ts`

```typescript
program.option('--agent', 'Enable agent mode: ANSI-stripped output with Layer 2 protections');
```

`--agent` activates Layer 2 (ANSI strip, binary guard, overflow) but does NOT change output format. `--format json` remains independent — agents discover it via `--help` when they need structured parsing.

**Gate:** `printf '\x00binary\x00' | gwrk echo --agent` returns `[binary content, N bytes]`.

### 3.2 stdin Acceptance for `define plan` (2 SP)

#### [MODIFY] `src/commands/define.ts`

When stdin is not a TTY, read it as discovery JSON and pass to the plan generator:

```typescript
if (!process.stdin.isTTY) {
  const discovery = await readStdin();
  // Pass discovery as context to agent dispatch
}
```

Pipeline: `gwrk project discover --json | gwrk define plan --spec specs/004/spec.md --json`

**Gate:** Pipeline produces valid plan JSON.

### 3.3 Classification Inference (2 SP)

#### [NEW] `src/engine/classify.ts`

During `/plan-to-tasks`, classify each task:

| Classification | Detection |
|---|---|
| `greenfield` | File in `touch_points` does not exist |
| `change` | File exists, task modifies behavior |
| `refactor` | File exists, task changes structure not behavior |
| `noop` | No code change required (config, docs) |

Classification stored in `tasks.json`:

```json
{ "id": "T001", "classification": "greenfield", ... }
```

**Gate:** `jq '.phases[0].tasks[0].classification' tasks.json` returns valid classification.

### 3.4 Phase Schema Enrichment (2 SP)

#### [MODIFY] `src/utils/state.ts`, Zod schemas

Add optional fields to phase and task schemas:

```typescript
const PhaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  // New optional fields (non-breaking)
  objective: z.string().optional(),
  scope: z.object({
    in_scope: z.array(z.string()),
    out_of_scope: z.array(z.string()),
  }).optional(),
  classification_summary: z.record(z.number()).optional(),
  inputs: z.object({
    spec_refs: z.array(z.string()),
    project_signals: z.array(z.string()),
  }).optional(),
  tasks: z.array(TaskSchema),
});
```

All new fields are `.optional()` — existing `tasks.json` files remain valid.

**Gate:** Existing tests pass. New fields accepted by schema validation.

---

## Verification Plan

### Automated Tests

```bash
# Phase 1 gates
gwrk status 2>/dev/null                    # clean stdout
gwrk status 2>&1 >/dev/null | grep 'exit:' # signal present
gwrk tasks list --format json | jq .       # valid JSON
gwrk gate-check T001 --format json | jq .  # structured gate result

# Phase 2 gates
gwrk project discover --format json | jq . # project discovery works
gwrk project specs --format json | jq .    # spec inventory
gwrk tasks list nonexistent 2>&1 | grep "Run '" # error navigation

# Phase 3 gates
gwrk project discover --json | gwrk define plan --spec specs/000/spec.md --json # pipeline
jq '.phases[0].tasks[0].classification' specs/000/.gwrk/tasks.json # classification
pnpm test                                  # all existing tests pass
```

### Manual Verification

- Run WUD on a feature using only `gwrk` commands (no raw shell)
- Verify `--agent` mode output is clean, bounded, and parseable
- Verify pipe composition works end-to-end

---

## Wave Summary

| Phase | SP | Est. Hours | New Files | Modified Files |
|---|---|---|---|---|
| Phase 1 — Foundation | 7 | 35h | `signal.ts`, `output.ts`, `gate-check.ts` | All commands, `cli.ts` |
| Phase 2 — Discovery | 10 | 50h | `project.ts`, `discover.ts` | All help text, all error paths |
| Phase 3 — Agent Mode | 11 | 55h | `agent-layer.ts`, `classify.ts` | `define.ts`, `state.ts`, `cli.ts` |
| **Total** | **28** | **140h** | **6 new files** | **~15 modified** |

---

## Build Plan Integration

Feature 013 inserts into `000-build-plan.md` v7:

```
F001 ✅ → F013 (Agent-Native) → F004 (Ship Loop)
                             → F008 (Agent Router)
```

Net impact: F004 drops from 8→5 SP, F008 drops from 10→7 SP. Net: +22 SP but architecturally superior.
