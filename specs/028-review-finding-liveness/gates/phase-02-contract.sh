#!/bin/bash
set -euo pipefail
# AUTHORED
# Phase 02 baseline — 028-review-finding-liveness (T003), FR-008 / TR-008.
#
# `runTaskGate` strategy 1 always prefers `gates/<id>-gate.sh` when it exists
# (src/utils/gate-exec.ts:63-74), so the FILE is the executed artifact and
# T003's declared `gateScript` never runs beside it. That is exactly how the
# previous T003 gate — `test -f` plus `pnpm vitest run ship-orchestrator.test.ts`
# — stayed green on a tree where `ReviewFindings` and `descriptionOnly` do not
# exist at all: it asserted nothing about FR-008. This file runs Phase 02's
# `#### Done When` block verbatim, `gates/T003-gate.sh` delegates here, and
# T003's `gateScript` delegates to that gate: declared, planned and executed
# are the same nine commands, with nothing left to drift into dead text.
#
# Location-independent: resolve the repo root from this script, not from $PWD.

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$REPO_ROOT"

ORCH="src/engine/ship-orchestrator.ts"
SUITE_LIVENESS="src/engine/ship-orchestrator.review-finding-liveness.test.ts"
SUITE_DIVERGENCE="src/engine/ship-orchestrator.review-gate-divergence.test.ts"
SUITE_REVIEW="src/engine/ship-orchestrator.review.test.ts"

fail() { echo "FAIL: phase-02 — $1" >&2; exit 1; }

# ── plan.md > Phase 02 > Done When, command for command.

# 1. Build. Phase 02 widens `readVerdict`'s parameter from `Set<string>` to
#    `ReviewFindings`; tsc is what proves the default-parameter form still
#    compiles for the no-argument callers in the other two suites.
npm run build || fail "npm run build"

# 2-4. The suite that owns TR-008, plus the two suites the signature change
#      passes through. `npx`, not `pnpm`: `pnpm vitest` re-resolves the store
#      and aborts on `pnpm install` when there is no TTY.
npx vitest run "$SUITE_LIVENESS" || fail "vitest: $SUITE_LIVENESS"
npx vitest run "$SUITE_DIVERGENCE" || fail "vitest: $SUITE_DIVERGENCE"
npx vitest run "$SUITE_REVIEW" || fail "vitest: $SUITE_REVIEW"

# 5-6. The detection mechanism itself, in the production file. `descriptionOnly`
#      is the discriminator: it exists only once `detectReviewReopens` returns
#      `ReviewFindings` and diffs descriptions against `beforeState`, so a
#      revert to the status-only signal turns this gate red.
grep -q 'REVIEW FAIL (' "$ORCH" || fail "$ORCH: the REVIEW FAIL ( marker detection is gone"
grep -q 'descriptionOnly' "$ORCH" || fail "$ORCH: detectReviewReopens no longer reports description-only findings"

# 7-9. The three named TR-008 cases. A `-t` filter exits 0 on no match, so
#      assert against the test source instead of asking vitest to select them.
liveness_case() {
  grep -q "$1" "$SUITE_LIVENESS" || fail "$SUITE_LIVENESS lost the TR-008 case: $1"
}

liveness_case 'treats a newly appended REVIEW FAIL block as a finding'
liveness_case 'reports NO-GO on a description-only finding'
liveness_case 'does not re-fire on a pre-existing REVIEW FAIL block'

echo "PASS: phase-02 — a REVIEW FAIL block appended during the dispatch is a finding, and reaches the verdict without a status flip"
