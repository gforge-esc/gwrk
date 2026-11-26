# Root CLI enrollment repair

The reviewed enrollment implementation is preserved. Two CLI entry-point defects remain. Blocked: missing local config prevents enrollment commands and registry-backed server commands from reaching their handlers.

## Preserved state

The parent task reset diverged from the reviewed final commit. Merge `d043f9a2` preserves final enrollment commit `20efe188` and its UAT findings. Merge `2a296c51` includes CI-only fixes `4cb8dea3` and `830c1f9d`. Both merges passed normal hooks with explicit author and committer identity.

The task ledger matches the reviewed final ledger. Enrollment task T042 and server task T045 remain open. Completed work remains intact. No production fix or ship run occurred during preparation.

## Findings

| Finding | Trigger | Cause | Required behavior |
|---|---|---|---|
| Enrollment CLI, T042 | `project enroll`, `project list` or `project show` without local config | Root pre-action validation | Let registry command handlers run |
| Server CLI, T045 | `server start`, `server _run` or `server status` without local config | Root pre-action validation | Reach the enrolled-project fallback |

`src/cli.ts` installs the pre-action hook near line 197. Its command exceptions omit these registry-backed commands. The fallback calls `loadConfig(process.cwd())` before command handlers execute. That function requires `.gwrkrc.json` in the current directory.

Enrollment therefore fails even inside a plain Git checkout. Global list and show operations also fail from an uninitialized directory. The premature error bypasses the handlers' operational signals and enrollment error navigation.

`src/commands/server.ts` already implements `loadServerConfig`. It falls back to SQLite enrollment when local config is absent. The root hook prevents that code from running. The archived review also requires lifecycle commands `server stop` and `server logs` to reach their own handlers.

The approved contracts are `spec.md` enrollment and local-entry requirements plus `contracts/slack-routing-and-operations.md` CLI enrollment and signal requirements. Preserve project identity verification and enrollment authorization. Keep existing validation of malformed local config. Keep effects in command and adapter boundaries.

## RED evidence

| Check | Observed result | Target |
|---|---|---|
| Restored UAT regressions | Reproduced, 2 failures; 20 passed; 1 skipped | Observe both defects before repair |
| Phase-six gate test selection | Reproduced, 3 failures; 90 passed; 1 skipped | Enrollment plus both startup paths fail |
| Build | Pass | Zero type errors |
| Lint | Pass | Zero findings |

The archived patch applied and passed its reverse check. Its SHA-256 is `31e464d629c9642eb4aed90fb9a671ca5ef4226b86154170dd83b185d628d57f`. The original remains in the private review archive for `048-project-identity-slack-ship-876b45ad`.

The active regressions are in `src/commands/project.test.ts` and `src/commands/server.test.ts`. The server regression now covers foreground startup and internal `_run` independently. It retains the original status assertions. Each failure reports missing `.gwrkrc.json` before handler execution.

The shared `gates/phase-06.sh` already selects both test files. No new test path was needed. The plan now lists the root CLI composition work and server entry-point coverage.

Logs remain in `.runs/root-cli-enrollment-repair-nov23/`. `restored-uat-red.log` records the exact restored patch. `phase6-red.log` records the strengthened gate selection. The folder also preserves the patch and review result.

## Next repair

Run one fresh bounded phase-six ship after root review of these uncommitted preparation changes. Repair command routing through the root pre-action hook. Preserve reviewed enrollment and server fallback behavior. Retain all restored assertions and require the shared phase gate to pass.

The tests use temporary repositories and isolated SQLite registries. Server startup is mocked in the new regression cases. Preparation performed no live Slack delivery or daemon operation.
