# Structured Vitest completion

Known Vitest profiles use structured result artifacts from an awaited public API producer. Independent review must clear this candidate before freezing it. The coordinator owns the bounded feature retry.

## Cause

The original baseline guard rejected completed suite-load failures before implementation. Its text exception then mistook nested fixture reports for outer failures. A second text candidate discarded a real load error containing a reporter-looking line. Both rejected candidates and their review receipts remain preserved.

Vitest 3.2.4 stock JSON provides assertion results and per-file errors. It omits global unhandled errors. Reporter callbacks also run concurrently. A last reporter can record completion before another reporter throws. Actual process regressions establish both gaps.

## Boundary

A shared profile selector enables the producer for explicit Vitest profiles without an opaque command override. Both runTests and ship suite execution use typed filter arrays. Opaque commands and unknown profiles retain the strict legacy path. The producer does not infer its framework from command text or output.

The project package context launches `pnpm exec node` with `gwrk-vitest-producer.mjs` and a private request file. The producer resolves project-owned Vitest. A public Vite configuration hook preserves configured reporters and their output settings. It adds verbose diagnostics and a stock JSON reporter with a private output file.

The producer captures public onTestRunEnd metadata. It awaits context.start and context.close before sealing completion. Rejected API calls or reporter failures cannot seal it. Unhandled errors and interrupted runs cannot authenticate completion either.

Vitest and Vite settle some shutdown rejections internally. Failure observers preserve the normal public project and plugin-container close calls. They record and rethrow rejection without closing resources early. The root project uses the public getRootProject method. Public onClose registrations receive the same failure observation. No underscored state or log text determines the verdict.

## Validation

Each execution creates a private directory with mode 0700. Its files use mode 0600. Reads require regular files without symlinks. They use no-follow descriptors and bounded buffers. Missing or malformed artifacts fail closed. Owned artifacts are removed after execution.

The stock report supplies assertion counts. Failed files with no assertions supply separate negative suite-load evidence during initial baseline only. Hook errors remain execution failures. Verification rejects load failures regardless of an older baseline. Counts and completion metadata must agree with normal process exit. No stdout fallback exists for a known producer.

## Evidence

Private receipts reside in `.runs/vitest-artifact-prep/` in the operator worktree.

| Receipt | Result |
|---|---|
| test-only-red.log | RED: nine failed and eight passed before implementation |
| mixed-unhandled-red.log | RED: stock JSON omitted a runtime error beside an assertion failure |
| reporter-throw-red.log | RED: last-reporter completion did not establish completion |
| close-marker-own-red.log | RED: public context close masked a real shutdown failure |
| close-container-own-green.log | PASS: observed public shutdown rejection |
| final-reviewed-green.log | PASS: 118 cases across eight files |
| final-reviewed-build.log | PASS |
| final-reviewed-lint.log | PASS |
| dependency-health-after.json | PASS: unchanged from the before receipt |
| actual-project-baseline-replay.json | PASS: captured feature snapshot retains baseline one |

The detached replay uses feature source `a689cb1d`. Its scoped suite records one failure and 86 passes. Its whole suite records one failure and 4531 passes. The known full-ID listing regression remains negative evidence. No implementation agent or feature job ran during this replay.

Native Node 22 verification separately covers the formerly text-dependent suite-load case. Actual process tests cover nested complete and truncated logs. They also cover real errors containing reporter-looking text and preserve the prior interruption regressions.

## Fixture ownership

Temporary projects use private copy-on-write dependency copies and faithful package manifests plus lockfiles. They never link writable dependencies to a mismatched temporary manifest. The before and after dependency fingerprints match. The independent hygiene finding and prior failure receipts remain private evidence.

## Handoff

The coordinator may select only the independently reviewed new operator commit and distribution. Both earlier frozen operators remain unchanged. Model routing and hosted runtime code remain outside this patch.
