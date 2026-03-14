# 013 Agent-Native Interface — Gap Analysis

> **Generated**: 2026-03-13 · **Workflow**: `/plan-to-tasks` Step 4
> **Inputs**: spec.md, plan.md, contracts/ (signal, output, discover, gate-check)

---

## Classification Legend

| Status | Meaning |
|---|---|
| `greenfield` | File does not exist. Must create from scratch. |
| `missing` | File exists but lacks the contract-required functionality. |
| `wrong` | File exists and contradicts the contract requirement. |

---

## Phase 1 — Foundation (7 SP)

### T: `src/utils/signal.ts` → `greenfield`

**Contract**: [signal.md](file:///Users/gonzo/Code/gwrk/specs/013-agent-native-interface/contracts/signal.md)

File does not exist. Must create `withSignal()` HOF.

**Required implementation**:
- `withSignal(name, fn)` wrapping function
- `performance.now()` timing
- Duration formatting (`<1s → Nms`, `≥1s → N.Ns`)
- stderr emission: `[exit:0 | 42ms]` or `[exit:1 | 3.2s] name: msg`
- Catch-all error handling (no unhandled rejections escape)

### T: All `src/commands/*.ts` — `withSignal()` wrapping → `missing`

**Contract**: signal.md — every command action must be wrapped

10 command files listed in plan.md exist, plus 7 additional command files not listed. **NONE** use `withSignal()`. Each `.action()` callback currently calls `process.exit()` directly. All 24 actions must be retrofitted.

| File | Actions | Exit Pattern | Notes |
|---|---|---|---|
| `define.ts` | 1 (parent) | `process.exit(1)` | Subcommands registered separately |
| `specify.ts` | 1 | `process.exit(1)` | Subcommand of define |
| `plan.ts` | 1 | `process.exit(1)` | Subcommand of define |
| `implement.ts` | 1 | `process.exit(1)` | Subcommand of define |
| `tasks-generate.ts` | 1 | `process.exit(1)` | `gwrk define tasks` |
| `ship.ts` | 1 | `process.exit(1)` | Long-running loop |
| `test.ts` | 1 | `process.exit(1)` | |
| `measure.ts` | 1 | none (delegates) | Parent for effort/compression/pulse |
| `effort.ts` | 1 | `process.exit(1)` | Subcommand of measure |
| `compression.ts` | 1 | `process.exit(1)` | Subcommand of measure |
| `pulse.ts` | 2 | `process.exit(1)` | `snapshot` + `generate` |
| `tasks.ts` | 4 | `process.exit(1)` | `done`, `list`, `next`, `ready` |
| `runs.ts` | 1 | `process.exit(1)` | `gwrk db runs` |
| `stats.ts` | 1 | `process.exit(1)` | `gwrk db stats` |
| `db.ts` | 1 | `process.exit(1)` | Parent for runs/stats |
| `server.ts` | 3 | `process.exit(1)` | `start`, `stop`, `clean` |
| `status.ts` | 1 | `process.exit(1)` | |
| `init.ts` | 1 | `process.exit(1)` | |
| `setup-slack.ts` | 1 | `process.exit(1)` | |

**Total: 24 `.action()` callbacks across 19 files.**

### T: `src/utils/output.ts` → `greenfield`

**Contract**: [output.md](file:///Users/gonzo/Code/gwrk/specs/013-agent-native-interface/contracts/output.md)

File does not exist. Must create `CommandOutput` interface and `createOutput()` factory.

### T: `src/cli.ts` — `--format` global flag → `missing`

**Current state**: 116 lines. Has Commander program setup, `configureHelp()`, command registration, `preAction` hook. **No `--format` option exists.** No `--agent` option exists.

**Required**:
- Add `program.option('--format <type>', ...)` (Phase 1)
- Add `program.option('--agent', ...)` (Phase 3)

### T: Commands retrofit for `CommandOutput` → `missing`

`tasks.ts`, `status.ts`, `measure.ts` currently write directly to `console.log()`. Must be retrofitted to use `CommandOutput` so `--format json` works.

### T: `src/commands/gate-check.ts` → `greenfield`

**Contract**: [gate-check.md](file:///Users/gonzo/Code/gwrk/specs/013-agent-native-interface/contracts/gate-check.md)

File does not exist. Must create `gwrk gate-check <task_id>` command with gate script resolution, execution, and structured result output.

### T: Exit code standardization → `wrong`

**Current state**: All commands use `process.exit(1)` for all error types. No `exit(2)` for usage errors. No `exit(127)` for unknown commands. Commander.js default for unknown commands is `process.exitCode = 1`, not 127.

**Spec FR-009 requires**: 0=success, 1=expected failure, 2=usage error, 127=unknown command.

---

## Phase 2 — Discovery (10 SP)

### T: `src/commands/project.ts` → `greenfield`

**Contract**: [discover.md](file:///Users/gonzo/Code/gwrk/specs/013-agent-native-interface/contracts/discover.md)

Parent command group does not exist. Must create `project` command with `discover`, `specs`, `gates` subcommands.

### T: `src/engine/discover.ts` → `greenfield`

**Contract**: [discover.md](file:///Users/gonzo/Code/gwrk/specs/013-agent-native-interface/contracts/discover.md)

Discovery engine does not exist. Must implement `discoverProject(root)` that assembles `ProjectDiscovery` from git + filesystem only (TC-004: no SQLite, no server).

**Data sources to implement**:
- Git state via `git status --porcelain`, `git branch --show-current`, `git log -1`
- Spec inventory via glob `specs/*/spec.md` + status derivation
- Gate aggregation via gate script execution
- Config from `.gwrkrc.json`
- Agent detection via `which gemini/claude/codex`

### T: Help text rewrite → `missing`

All commands have basic `--help` via Commander defaults. **None** include:
- Command type (query/generator/verifier/mutator)
- Exit codes section
- Available format options
- Mutation declarations

Current `formatHelp()` in `cli.ts` (lines 30-84) is cosmetic only — ANSI-colored header with Foxtrot Charlie branding. Per-command help is Commander auto-generated.

### T: Error-as-navigation → `missing`

Systematic audit of error messages across all commands:

**Current pattern**: `console.error("Error: ...")` + `process.exit(1)`
**Required pattern**: Include `Run '<corrective command>'` in every error message.

Many existing errors already have *some* corrective guidance (e.g., `tasks-generate.ts` suggests `gwrk define tasks <feature> --force`), but most do not follow the spec's three-part pattern: what failed + what to run + `--help` reference.

---

## Phase 3 — Agent Mode (11 SP)

### T: `src/utils/agent-layer.ts` → `greenfield`

Layer 2 protections: `stripAnsi()`, `guardBinary()`, `truncateOverflow()`. File does not exist.

**Note**: ANSI codes are currently hardcoded in `src/utils/format.ts` via raw `\x1b[` sequences. The `stripAnsi()` function will need to handle these exact patterns.

### T: `src/commands/define.ts` — stdin acceptance → `missing`

`define plan` currently invokes an agent via shell. Does not read stdin. Must add `process.stdin.isTTY` check for pipe composition.

### T: `src/engine/classify.ts` → `greenfield`

Task classification engine. Does not exist.

### T: `src/utils/state.ts` — PhaseSchema enrichment → `missing`

**Current PhaseSchema** (lines 22-27):
```typescript
export const PhaseSchema = z.object({
  id: z.string().regex(/^phase-\d{2}$/),
  title: z.string().min(1),
  tasks: z.array(TaskSchema).min(1),
  doneWhen: z.array(z.string()).optional(),
});
```

**Required additions** (plan Phase 3.4): `objective`, `scope`, `classification_summary`, `inputs` — all as `.optional()` fields. Non-breaking.

---

## Summary

| Classification | Count | Files |
|---|---|---|
| `greenfield` | 7 | signal.ts, output.ts, gate-check.ts, project.ts, discover.ts, agent-layer.ts, classify.ts |
| `missing` | 7 | cli.ts (flags), all commands (withSignal), all commands (CommandOutput), all help text, all error messages, define.ts (stdin), state.ts (schema) |
| `wrong` | 1 | Exit codes (all errors use exit(1), no exit(2)/exit(127) differentiation) |
