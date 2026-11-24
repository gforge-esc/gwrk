# Independent Gate Capture Review

Verdict is **NO_GO** for commit `ed39e5ccb04041c4553a7bddc4d5c032d44bd44b`. `isMaxBufferError` misclassifies ordinary nonzero exits as 16 MiB buffer overflows. This happens whenever `stderr`, a script path or an inline script mentions `maxBuffer` or `ENOBUFS`. Blocked on gate capture component clearance. Owner is the implementation author.

## Requirement Verification

| Requirement | Target | Observed | Verdict |
|---|---|---|---|
| Bounded 16 MiB capture | 16777216 bytes across file, convention and inline | `GATE_MAX_BUFFER_BYTES` is 16777216 in `runGate` and `runInlineGate` | Passes |
| Static overflow prefix | Explicit prefix at start of failed output | `Gate output exceeded maximum buffer limit (<N> bytes)` starts output | Passes |
| Real child-process capture | Pass 1.2 MiB stdout and stderr, fail finite cap | All 6 behavioral cases pass in commit `ed39e5cc` | Passes |
| Preserve nonzero exits and timeouts | Unaltered output on ordinary failures and timeouts | 5 real nonzero cases misclassified as buffer overflow | Fails |
| No unbounded buffers or new user config | No `Infinity` default or new config surface | No new config schema, env var or CLI flag added | Passes |

## Blocking Finding

False-positive overflow classification breaks ordinary nonzero exits in both `runGate` and `runInlineGate`.

- WHERE: `src/utils/gate-runner.ts:16-29` (`isMaxBufferError`), called from `src/utils/gate-runner.ts:102` (`runGate`) and `src/utils/gate-exec.ts:216` (`runInlineGate`).
- EXPECTED: Classify overflow only from Node child process error codes `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` and `ENOBUFS`. Ordinary nonzero exits return their raw output without the overflow prefix.
- ACTUAL: `isMaxBufferError` falls back to `err.message.includes("maxBuffer") || err.message.includes("ENOBUFS")`. Node `execFile` embeds the script path and `stderr` in `err.message`. Node `execSync` embeds the inline script body in `err.message`. Any failing gate whose `stderr`, script path or inline command contains `maxBuffer` or `ENOBUFS` gets prefixed with `Gate output exceeded maximum buffer limit (16777216 bytes)`.
- FIX: Remove the `err.message` substring fallback in `src/utils/gate-runner.ts:25-27` and classify strictly by `err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" || err.code === "ENOBUFS"`. Add the 5 real child-process regression cases from `.runs/gate-capture-independent-review/false-positive-overflow-regression.patch` and confirm RED then GREEN.
- REPRODUCTION: Apply `.runs/gate-capture-independent-review/false-positive-overflow-regression.patch` and run `python3 /Users/gonzo/Code/gwrk/.runs/run-heavy-check.py -- pnpm vitest run --pool=forks --poolOptions.forks.maxForks=2 --reporter=verbose src/utils/gate-runner.test.ts src/utils/gate-exec.test.ts`. Observed 5 failed and 33 passed in `.runs/gate-capture-independent-review/false-positive-overflow-regression.red.log`.

## Nonblocking Improvements

- Temp directory cleanup: `src/utils/gate-exec.test.ts:278-286` creates temporary directories with `fs.mkdtempSync` in `beforeEach` without an `afterEach` cleanup call. Add `fs.rmSync(tmpDir, { recursive: true, force: true })` in `afterEach`.
- Finite override guard: `src/utils/gate-runner.ts:58` and `src/utils/gate-exec.ts:159` accept any caller-provided numeric `maxBuffer`. Validate `Number.isFinite(maxBuffer) && maxBuffer > 0` or clamp to `GATE_MAX_BUFFER_BYTES` so callers cannot pass `Infinity`, `NaN` or non-positive values.
- Unused error field: `src/utils/gate-runner.ts:18` declares `name?: unknown` in the cast inside `isMaxBufferError` without reading it. Remove `name?: unknown`.
- Additional behavioral coverage: `src/utils/gate-exec.test.ts:34-78,316-329` does not test `runTaskGate` forwarding an explicit `maxBuffer` to `runGate`. It also skips `realRunGate` overflow on `stderr` or with `timeoutMs` set. Probe checks confirmed `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` does not set `killed: true` with `SIGKILL` under `timeoutMs`.

## Evidence and Hash Verification

All 4 reviewed source files in `/Users/gonzo/Code/gwrk-worktrees/gate-capture-review-nov24` match the SHA-256 hashes recorded in `/Users/gonzo/Code/gwrk-worktrees/gate-capture-config-nov24/.runs/gate-capture-prep/manifest.json`. The author `red.log` (10 failed, 23 passed) and `green.log` (33 passed) match their recorded hashes.

| Artifact | SHA-256 | Status |
|---|---|---|
| `src/utils/gate-runner.ts` | `4aa29e543979c1e51ba8c3b1c3ab103344a6343d38ca750248ef9046de5527a3` | Matches author manifest |
| `src/utils/gate-exec.ts` | `3f69455b55aa64912c3a8d60a3ec580a1bc1de72f3c6fd4bbc7f71d146252533` | Matches author manifest |
| `src/utils/gate-runner.test.ts` | `23470c817d836ff9d55bbc0e9e967f9f6ad6f0d08b46c657d135ab0412e4905e` | Matches author manifest |
| `src/utils/gate-exec.test.ts` | `e442fbbcdfc5caa1665fae1423670d47e357a3dbc7a6a7bdc10e4bf8b023bebf` | Matches author manifest |
| `.runs/gate-capture-independent-review/false-positive-overflow-regression.patch` | `27743cb0a03baeab2072ebe2c517246e47c16e51b0af8dcae5cb3c45ff2d2043` | Applies cleanly (`git apply --check`) |
| `.runs/gate-capture-independent-review/false-positive-overflow-regression.red.log` | `a90ff27024bd237fe605b674ba0ba327b731735724752c37088979c641497757` | 5 failed, 33 passed |

## Architecture and Scope

Reviewed against `AGENTS.md`, `.gwrk/architecture.md` and `.gwrk/decisions/index.md`. Checked Decided records ADR-001 and ADR-005 along with ADR-008 and ADR-011. Also checked Proposed ADR-013. No hexagonal layer violations or new configuration mechanisms appear in the 4 files. Scope stayed bounded to the 4 gate utility and test files. A future `GO` after remediation grants component clearance only, not Phase 5 completion.
