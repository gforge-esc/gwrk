# 027 — Gate-invoked-test liveness

> **Status:** Proposed · **Depends on:** 026 (one `runTaskGate`) · **Resolves:** 026 OQ-001.
>
> **⚠ Do not merge while the dashboard is actively shipping off local `develop` rebuilds.** This
> changes gate pass/fail behavior (adds a liveness failure mode). Merge once the dashboard is stable
> so no in-flight run changes underfoot.

## 1. Problem

A gate can exit 0 while executing zero tests. `make test:db` that discovers no tests, or a suite
whose before-hook cancels everything, still returns 0 — a false green. 026 unified gate execution
in `runInlineGate` but left this liveness gap (OQ-001), because naively asserting `testsRun > 0` on
a full gate's combined output would false-fail opaque wrappers that hide their counts.

## 2. Decision — conservative liveness

In `runInlineGate` (so it applies to every driver: `gwrk gate`, ship TEST_GATE / CODE_REVIEW /
post-flight, harvest), after a gate exits 0, fail it iff ALL hold:

1. a gate line is an integration test command (`isIntegrationTestCommand`), AND
2. the output has a RECOGNIZED test summary (`hasRecognizedTestSummary` — node TAP `# pass`/`# fail`,
   a vitest/jest `Tests` line, or pytest-style `N passed`/`N failed`), AND
3. `parseTestOutput(output).testsRun === 0`.

If the output is opaque (no recognized summary) the gate PASSES — an opaque wrapper is never
false-failed. A gate with no test invocation is untouched. This is strictly narrower than
`runIntegrationGate`'s existing `testsRun === 0` NO-GO (which runs the command in isolation); 027
only fires on a positively-recognized zero.

## 3. Functional Requirements

- **FR-001** — `hasRecognizedTestSummary(output)` (in `test-runner.ts`) returns true only for a
  recognized runner summary.
- **FR-002** — `runInlineGate` fails a passing gate when conditions 1–3 hold, with an offendingLine
  naming the liveness fault; otherwise unchanged.

## 4. Test Requirements

- **TR-001** — recognized 0-test summary + test invocation → FAIL.
- **TR-002** — recognized N>0 summary → PASS.
- **TR-003** — opaque output + test invocation → PASS (no false-fail).
- **TR-004** — no test invocation → PASS regardless of output.
  (`src/utils/gate-exec.test.ts`.)

## 5. Verification

`pnpm run build` + `pnpm run test:ci` green (only the 3 known local-only `server.test.ts` failures).
The existing gate/ship/harvest suites stay green because their mocked gate outputs are empty → no
recognized summary → no liveness fire.

## 6. Out of scope

Making opaque wrappers honest-fail (ADR-005 §10.4's stricter aspiration) — that needs a
project-side "emit TAP/structured counts" requirement, not a gwrk default that regresses passing
gates.
