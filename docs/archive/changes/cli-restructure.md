# CLI Hierarchy Restructure — Change Summary

> **Date:** 2026-03-06
> **Status:** Implemented, tests passing, build clean.

## What Changed

The CLI was restructured from an **implementation-leaked hierarchy** to a **Foxtrot Charlie pillar-based hierarchy**. Commands are now organized by what the user is doing (Define → Ship → Measure), not by how they run internally (agent workflow vs shell script vs TypeScript).

## Old Hierarchy (DEAD — do not reference)

```
gwrk run specify <prompt>           # REMOVED
gwrk run plan <feature>             # REMOVED
gwrk run analyze <feature>          # REMOVED
gwrk define <feature>               # CHANGED (was: only tasks→analyze loop)
gwrk implement <feature> <phase>    # REMOVED
gwrk wud <feature> <phase>          # REMOVED
gwrk metrics effort <feature>       # REMOVED
gwrk metrics compression <feature>  # REMOVED
gwrk pulse                          # REMOVED
gwrk tasks generate <feature>       # REMOVED (moved under define)
```

## New Hierarchy (CURRENT — source of truth)

### `gwrk define` — DUS Pillar (Clarity)

```
gwrk define <feature> [--refs <path>]    # Full DUS loop: spec→plan→tasks→checklist→analyze→tests
gwrk define spec <feature> [--refs ...]  # Create/refine spec (was: run specify)
gwrk define plan <feature> [--refs ...]  # Create implementation plan (was: run plan)
gwrk define tasks <feature>              # Decompose plan → tasks.json + gates (was: tasks generate)
```

- `analyze`, `checklist`, and `tests` are **internal DUS loop stages**, NOT exposed as standalone subcommands.
- `--refs <path>` passes additional reference docs to the agent beyond standard project docs.
- Bare `gwrk define <feature>` runs the full DUS loop via `define-until-solid.sh`.

### `gwrk ship` — ZFG/WUD Pillar (Throughput)

```
gwrk ship <feature> <phase>                           # Implement a phase (was: implement)
gwrk ship done <feature> <phase> [--max-iterations]   # WUD autonomous loop (was: wud)
```

### `gwrk measure` — Pulse/Compression Pillar (Value)

```
gwrk measure pulse [--days N]         # Git activity dashboard (was: pulse)
gwrk measure effort <feature>         # SP-driven estimation (was: metrics effort)
gwrk measure compression <feature>    # Effort vs actual ratio (was: metrics compression)
```

### Unchanged

```
gwrk init                             # Project scaffolding
gwrk tasks list <feature>             # Query task state
gwrk tasks next <feature> <phase>     # Next open task
gwrk tasks done <feature> <taskId>    # Complete task via gate
gwrk db runs <feature>                # Query execution ledger
gwrk db stats                         # Aggregate stats
```

## Design Rationale

1. **User-centric grouping.** Commands grouped by the Foxtrot Charlie pillars — what the user is *doing*, not how the command *runs* internally.
2. **`run` was an implementation leak.** It existed because those commands dispatched to agent workflows vs shell scripts. The user doesn't care.
3. **`analyze` is internal.** It's a quality gate inside the DUS loop, not a standalone user action.
4. **Hard cut, no aliases.** Old commands error immediately. No backward compatibility period.

## Implementation Files

| File | Role |
|---|---|
| `src/cli.ts` | Router — registers define, ship, measure |
| `src/commands/define.ts` | Parent: bare=DUS loop, subcommands: spec, plan, tasks |
| `src/commands/ship.ts` | Parent: default=implement, done=WUD |
| `src/commands/measure.ts` | Parent: pulse, effort, compression |
| `src/commands/tasks-generate.ts` | Extracted from tasks.ts for define subcommand |
| `src/commands/specify.ts` | Renamed command from "specify" to "spec" |

## Output Contract

All commands use `src/utils/format.ts` for consistent output:
- **Open:** `┌───┐` box with command name + metadata
- **Body:** Per-line `HH:MM:SS +MM:SS` timestamps
- **Close:** `┌───┐` box with ✓/✗, duration, run ID, log path
- No raw `console.log` with ad-hoc formatting. Governance, not suggestion.
