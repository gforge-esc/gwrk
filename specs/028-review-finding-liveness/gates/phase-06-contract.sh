#!/bin/bash
set -euo pipefail
# AUTHORED
# Phase 06 baseline — 028-review-finding-liveness (T009), TR-012 / VR-001…VR-007.
#
# `runTaskGate` strategy 1 always prefers `gates/<id>-gate.sh` when it exists
# (src/utils/gate-exec.ts:63-73) and never reads `task.gateScript`, so the FILE
# is the executed artifact. `gates/T009-gate.sh` was the last one left in the
# generated form — `test -f` plus one `pnpm vitest run` on the file it had just
# checked for — and it printed PASS in 894ms while T009's declared `gateScript`,
# run verbatim, exited 1. One of eight declared checks ran; VR-001…VR-007 were
# unexecuted text. A green console over a failing contract is the exact defect
# class this feature exists to eliminate, and it had reached the phase whose
# whole purpose is verification.
#
# This file runs Phase 06's `#### Done When` block verbatim, `gates/T009-gate.sh`
# delegates here, and T009's `gateScript` delegates here too: declared, planned
# and executed are one artifact, with nothing left to drift into dead text.
#
# Location-independent: resolve the repo root from this script, not from $PWD.

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$REPO_ROOT"

SUITE_LIVENESS="src/engine/ship-orchestrator.review-finding-liveness.test.ts"
SUITE_DIVERGENCE="src/engine/ship-orchestrator.review-gate-divergence.test.ts"
SUITE_REVIEW="src/engine/ship-orchestrator.review.test.ts"
SUITE_LEDGER="src/engine/ship-orchestrator.findings-ledger.test.ts"
SUITE_PROMPTS="src/engine/review-prompts.test.ts"
PROMPT_CLI="src/plugins/builtins/reviews/review-code-cli/PROMPT.md"
PROMPT_WEBAPP="src/plugins/builtins/reviews/review-code-webapp/PROMPT.md"
# tsc strips the leading `src/`, so the published copy is dist/plugins/…, not
# dist/src/plugins/… . Naming both sides explicitly keeps this honest.
DIST_PROMPT_CLI="dist/plugins/builtins/reviews/review-code-cli/PROMPT.md"
DIST_PROMPT_WEBAPP="dist/plugins/builtins/reviews/review-code-webapp/PROMPT.md"
ADR="docs/decisions/ADR-007-single-dispatch-path.md"

fail() { echo "FAIL: phase-06 — $1" >&2; exit 1; }

# ── plan.md > Phase 06 > Done When, command for command.

# 1. VR-001. dist/ is what `gwrk ship` dispatches, and the postbuild copy the
#    two diffs below assert is a build side effect — a source-only pass would
#    prove nothing about the prompts that actually go out.
npm run build || fail "npm run build (VR-001)"

# 2. TR-012 plus the two suites the seam passes through. `npx`, not `pnpm`:
#    `pnpm vitest` re-resolves the store and aborts on `pnpm install` with no TTY.
npx vitest run "$SUITE_LIVENESS" "$SUITE_DIVERGENCE" "$SUITE_REVIEW" \
  || fail "vitest: the three review suites (VR-003 / TR-012)"

# 3-4. The ledger and the prompt contract. VR-005 (D1/D9 absence: no phase-wide
#      force-complete, the §4.0 one-way rule present) and VR-006 (VERDICT
#      CHANNEL, the cross-phase guard, the DIAGNOSE regex, the D10 sentence
#      absent) are asserted inside $SUITE_PROMPTS — this is where they run.
npx vitest run "$SUITE_LEDGER" || fail "vitest: $SUITE_LEDGER"
npx vitest run "$SUITE_PROMPTS" || fail "vitest: $SUITE_PROMPTS (VR-005 / VR-006)"

# 5-6. VR-004 / TC-005: postbuild copied both prompts, so the dispatched file is
#      the one under contract.
diff -q "$PROMPT_CLI" "$DIST_PROMPT_CLI" || fail "postbuild did not copy $PROMPT_CLI (VR-004 / TC-005)"
diff -q "$PROMPT_WEBAPP" "$DIST_PROMPT_WEBAPP" || fail "postbuild did not copy $PROMPT_WEBAPP (VR-004 / TC-005)"

# 7. VR-005 / TC-007: the two code-review prompts stay byte-identical.
diff -q "$PROMPT_CLI" "$PROMPT_WEBAPP" || fail "the two code-review prompts diverged (VR-005 / TC-007)"

# 8. VR-007: the ADR carries the 028 one-way correction.
grep -q '028 correction' "$ADR" || fail "$ADR lost the 028 correction (VR-007)"

# 9. TR-012: the seam proof is driven by the real transcript shape, not a
#    convenient fixture.
grep -q 'the exact runs #2727/#2728 shape' "$SUITE_LIVENESS" \
  || fail "$SUITE_LIVENESS no longer pins the runs #2727/#2728 transcript shape (TR-012)"

# 10. VR-002: the suite exits non-zero on the known live-state-coupled failures,
#     so capture and assert the invariant instead of the exit code. NO_COLOR
#     keeps the log ANSI-free for an exact match. Both `|| true` guards are
#     deliberate: the run fails on the known quarantine, and grep exits 1 when a
#     fully green run yields no FAIL lines. The assertions that decide this gate
#     all read captured files, and their own exit status is enforced by `set -e`.
#
#     The quarantine names TWO files, not one. `src/commands/server.test.ts` (3
#     cases, daemon spawn) and `src/server/routes/status.test.ts` (1 case, the
#     server binds a port and reads live daemon state, so `startServer` hits
#     `process.exit(1)` at src/server/index.ts:177). Both are pre-existing
#     live-state coupling, untouched by this feature; naming only the first made
#     this assertion exit 1 on a tree where nothing was wrong. `command grep`
#     bypasses any interactive alias, and `-E` is required: in BRE `|` is a
#     literal pipe, so a BRE alternation would silently match neither branch.
NO_COLOR=1 npm run test:ci > /tmp/028-test-ci.log 2>&1 || true
command grep -E '^ *FAIL ' /tmp/028-test-ci.log > /tmp/028-test-ci-failures.log || true
if command grep -vqE 'src/commands/server\.test\.ts|src/server/routes/status\.test\.ts' /tmp/028-test-ci-failures.log; then
  echo 'FAIL: a test failed outside the known server.test.ts / status.test.ts live-state quarantine' >&2
  command grep -vE 'src/commands/server\.test\.ts|src/server/routes/status\.test\.ts' /tmp/028-test-ci-failures.log >&2 || true
  exit 1
fi

echo "PASS: phase-06 — the runs #2727/#2728 seam holds and VR-001…VR-007 all ran"
