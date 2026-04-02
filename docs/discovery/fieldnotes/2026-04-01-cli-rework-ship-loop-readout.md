---
createdAt: 2026-04-01T16:27:00-06:00
source: F014-R ship loop debugging session
project: gwrk
tags: [cli-ux, rework, 001-cli-core, ship-loop, stdout, observability]
supersedes: null
---

# Fieldnote: CLI Human Readout Rework (001-R)

## Trigger

During the F014-R shipping session (2026-04-01), the `gwrk ship` loop surfaced 7 distinct bugs across `ship-orchestrator.ts`, `ship.ts`, `agent.ts`, and `git.ts`. Each bug required iterative diagnosis because the CLI's human-readable output obscured the root cause:

1. **ENOENT string exitCode** — `ship.ts` assigned `"ENOENT"` to a numeric `exitCode` field. The failure banner showed `exit 1` with no indication of the string coercion.
2. **Bare workflow strings** — `ShipOrchestrator` passed `"implement"` instead of `.agents/workflows/gwrk-implement.md`. Silent exit 1.
3. **No try-catch on dispatch** — `stageCodeReview` and `stageUatReview` let exceptions propagate past the `StageResult` error handling. Silent exit 1.
4. **Error message swallowed** — `ship.ts` catch block logged exit code but not the actual error message.
5. **Branch already exists** — `stageBranchSetup` used `git checkout -b` unconditionally. Error message was surfaced (after fix #4) but the UX offered no recovery guidance.
6. **Dirty tree on config edit** — `.gwrkrc.json` edit left tree dirty. The error was clear but the information hierarchy was wrong — the _reason_ was buried in the orchestrator log, the _banner_ just said `exit 1`.
7. **SQLite missing named param** — `recordRoutingDecision` omitted `error_message`, crashing `better-sqlite3`. The CODE_REVIEW agent completed with GO but the crash happened in the post-dispatch DB recording, making it appear as a review failure.

In every case, the human operator (PM) had to escalate to an agent to diagnose, because the CLI output was too chatty to surface the actual failure signal.

## Problem Statement

The gwrk CLI stdout contract serves two audiences with conflicting needs:

| Audience | Needs | Current State |
|----------|-------|---------------|
| **Human (PM)** | Root cause at a glance, recovery guidance, progress signal | ❌ Chatty agent logs, failure banner without error message, no recovery suggestion |
| **Agent (PE)** | Structured JSON, operational signals (`[exit:N \| Xs]`), parseable stderr | ✅ Well-served by F013 `--agent` and `--format json` modes |

The agent mode (F013) was designed correctly. The human mode was never designed — it's just raw agent log output with a colored banner stapled on top.

## Observations

### 1. Information Hierarchy Is Inverted

The loudest element in the output is the failure box:
```
┌─────────────────────────────────────────────┐
│  ✗ ship failed (exit 1)
│  Duration: 1m 52s
│  Run:      #2151
└─────────────────────────────────────────────┘
```

This tells the PM _that_ it failed, not _why_. The root cause (`Missing named parameter "error_message"`) was buried in line 42 of the chatty agent log. The error message added during this session helps, but it's still a `console.error` line lost in the scroll.

**Principle**: The root cause should be the loudest thing. The exit code is metadata.

### 2. No Recovery Guidance

When `BRANCH_SETUP` fails with "already exists", the output stops at the error. It should suggest: `Branch exists. Run with --resume-from IMPLEMENT or delete the branch.`

When the tree is dirty, it should suggest: `git stash` or `git commit -a`.

**Principle**: Every failure message should include a next-step suggestion.

### 3. Agent Log Is Not For Humans

The timestamped agent log (`16:18:14 +00:06  YOLO mode...`) is useful for post-mortem debugging but terrible for real-time human monitoring. The PM doesn't need to see every agent thought — they need:
- A progress bar or stage indicator (`BRANCH_SETUP → IMPLEMENT → CODE_REVIEW → UAT → PR`)
- Gate pass/fail summary (already partially there)
- A single-line verdict at the end
- A path to the full agent log for debugging

**Principle**: Human mode should show a pipeline visualization, not a transcript.

### 4. Rework Is A First-Class Workflow

gwrk treats rework as a constant (features are iterated, specs are amended, phases are re-shipped). But the tooling assumes greenfield:
- `gwrk ship` creates a new branch (fails on existing)
- No `gwrk rework` or `gwrk hotfix` command
- No way to ship a patch to a specific file without going through the full implement→review→PR cycle
- State files (`.runs/*.state`) accumulate without cleanup

**Principle**: The ship loop state machine needs a "rework" entry point that skips branch creation, runs targeted gates, and produces a minimal diff commit.

## Proposed Rework Scope (001-R)

### Human Readout Overhaul
- **Stage progress bar**: Replace chatty transcript with `⬤ BRANCH ─── ⬤ IMPLEMENT ─── ○ REVIEW ─── ○ UAT ─── ○ PR`
- **Failure hierarchy**: Root cause error as the primary visual element, exit code as metadata
- **Recovery suggestions**: Every error includes a `💡 Try:` line with concrete commands
- **Agent log suppression**: Default to summary mode; `--verbose` for full transcript
- **Verdicts as structured output**: `GO ✅ 6/6 tasks passed` or `NO-GO ⚠️ 2 tasks re-opened: T025, T026`

### Rework Support
- **`gwrk ship --rework`**: Skip branch creation, use current branch, run targeted gates
- **`gwrk hotfix <feature> <file>`**: Minimal patch workflow — edit, test, commit, push
- **State file cleanup**: Auto-prune `.runs/*.state` files older than 7 days
- **Rework history**: Track rework iterations in execution manifest (how many times was this phase re-shipped?)

### ADR-004 Amendment
- Formalize the Human Output Contract as a counterpart to the Agent Output Contract
- Define information hierarchy levels: `VERDICT > ERROR > PROGRESS > DEBUG`
- `--verbose` flag for full transcript mode (current behavior)
- Default mode: stage progress + verdict + error (if any)

## References

- `src/commands/ship.ts` — failure banner and error handling (lines 241-267)
- `src/engine/ship-orchestrator.ts` — stage dispatch and error propagation
- `src/utils/agent.ts` — agent log formatting (`stampLine`, `processLine`)
- `specs/013-agent-native-interface/spec.md` — F013 agent output contract (working reference for the inverse problem)
- `docs/decisions/ADR-004-agent-native-output.md` — existing agent output protocol (needs human counterpart)
