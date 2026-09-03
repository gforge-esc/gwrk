#!/bin/bash
set -euo pipefail
# AUTHORED
# Phase 01 shared baseline — 028-review-finding-liveness (T001 + T002).
#
# `runTaskGate` strategy 1 always prefers `gates/<id>-gate.sh` when it exists
# (src/utils/gate-exec.ts:64-74), so the FILE is the executed artifact and a
# task's declared `gateScript` never runs beside it. Both Phase 01 gates
# therefore delegate here, and both tasks' `gateScript` fields delegate to those
# gates: one baseline, one place to edit, nothing that can drift into dead text.
#
# Location-independent: resolve the repo root from this script, not from $PWD.

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$REPO_ROOT"

CLI="src/plugins/builtins/reviews/review-code-cli/PROMPT.md"
WEB="src/plugins/builtins/reviews/review-code-webapp/PROMPT.md"
DIST_CLI="dist/plugins/builtins/reviews/review-code-cli/PROMPT.md"
DIST_WEB="dist/plugins/builtins/reviews/review-code-webapp/PROMPT.md"
SUITE_PROMPTS="src/engine/review-prompts.test.ts"
SUITE_LIVENESS="src/engine/ship-orchestrator.review-finding-liveness.test.ts"
ORCH="src/engine/ship-orchestrator.ts"

fail() { echo "FAIL: phase-01 — $1" >&2; exit 1; }

# ── Build. postbuild copies src/plugins/builtins into dist/, which is the tree
#    PluginLoader dispatches from (TC-005). Everything below runs against both.
npm run build || fail "npm run build"

# ── The two suites under this phase.
npx vitest run "$SUITE_PROMPTS" || fail "vitest: $SUITE_PROMPTS"
npx vitest run "$SUITE_LIVENESS" || fail "vitest: $SUITE_LIVENESS"

# ── TC-007 twins, and TC-005: the dispatched bytes are the reviewed bytes.
diff -q "$CLI" "$WEB"
diff -q "$CLI" "$DIST_CLI"
diff -q "$WEB" "$DIST_WEB"

# ── TC-005: no uncompiled test source inside the tree postbuild publishes.
if find dist/plugins/builtins/reviews -name '*.test.ts' | grep -q .; then
  fail "a *.test.ts ships inside dist/plugins/builtins/reviews (files: [\"dist/\"] publishes it)"
fi
if [ -e "src/plugins/builtins/reviews/review-prompts.test.ts" ]; then
  fail "the prompt-contract suite is back inside the copied plugin tree"
fi

# ── FR-003 / FR-004, on every live copy of the prompt.
# Negative assertions use the if-form: `! grep -q` is exempt from `set -e` and
# can never fail a gate.
for f in "$CLI" "$WEB" "$DIST_CLI" "$DIST_WEB"; do
  grep -q 'Gate authority is one-way' "$f" || fail "$f: the one-way rule is gone"
  grep -q 'APPEND ONLY' "$f" || fail "$f: the APPEND ONLY contract is gone"
  grep -q 'Verification Gates — MECHANICAL BASELINE' "$f" \
    || fail "$f: Step 2 is no longer a mechanical baseline"
  grep -q 'MUST set that task' "$f" || fail "$f: the MUST-flip-status contract is gone"

  if grep -q 'tasks\[\].status) = "completed"' "$f"; then
    fail "$f: D1 phase-wide force-complete is back"
  fi
  if grep -q 'Using tasks.json status as primary verdict' "$f"; then
    fail "$f: the D9 anti-pattern is back (anywhere in the prompt, not just ## Anti-Patterns)"
  fi
  if grep -qi 'gates are truth' "$f"; then
    fail "$f: the broad 'gates are truth' doctrine is back"
  fi
  if grep -q 'Skip to Step' "$f"; then
    fail "$f: D1's bypass past the only re-opening step is back"
  fi
done

# ── W2 wiring in the orchestrator.
grep -q 'VERDICT CHANNEL' "$ORCH" || fail "the code-review scope context lost VERDICT CHANNEL"
grep -q 'Do NOT touch tasks belonging to any OTHER phase' "$ORCH" \
  || fail "the cross-phase guard is gone"
# Two greps, not one BRE alternation: in BRE `|` is a literal, so
# `grep -q 'REVIEW FINDING|REVIEW FAIL'` asserts only that the file contains
# that 27-character regex source — it would go red on an equivalent refactor to
# /REVIEW (FINDING|FAIL)/ and green on a file that has neither marker.
grep -q 'REVIEW FINDING' "$ORCH" || fail "the gateless REVIEW FINDING note is gone"
grep -q 'REVIEW FAIL' "$ORCH" || fail "the REVIEW FAIL marker is gone"
grep -q 'NOT "any open task → NO-GO"' "$ORCH" || fail "the FR-007 doc correction is gone"

# FR-007 is about a comment that DESCRIBES readVerdict, so assert attachment,
# not presence. `(?!\*/)` keeps the match inside a single comment block.
perl -0777 -ne 'exit 1 unless m{/\*\*(?:(?!\*/)[\s\S])*NOT "any open task → NO-GO"(?:(?!\*/)[\s\S])*\*/\s*private async readVerdict}' "$ORCH" \
  || fail "the doc block does not immediately precede \`private async readVerdict\`"

if grep -q 'note them in your summary but do NOT change its status' "$ORCH"; then
  fail "the D10 sentence is back in the scope context"
fi

# ── Named-case existence. A `-t` filter exits 0 on no match, so assert against
#    the test sources instead of asking vitest to select them.
prompts_case() {
  grep -q "$1" "$SUITE_PROMPTS" || fail "$SUITE_PROMPTS lost the case: $1"
}
liveness_case() {
  grep -q "$1" "$SUITE_LIVENESS" || fail "$SUITE_LIVENESS lost the case: $1"
}

prompts_case 'const ROOTS = \["src", "dist"\] as const'
prompts_case 'no longer names task status as the wrong verdict channel, anywhere'
prompts_case 'publishes no test source inside the copied reviews tree'
if grep -q 'expect(anti).not.toMatch(/Using tasks' "$SUITE_PROMPTS"; then
  fail "the D9 negative is section-scoped again — assert it against FLAT"
fi

liveness_case 'tells the review agent that re-opening the task is the NO-GO'
liveness_case "no longer tells it to leave a completed task's status alone"
liveness_case 'still forbids touching tasks from other phases'
liveness_case "readVerdict's doc comment states the real rule"
liveness_case 'reports NO-GO through stageCodeReview when the gate still passes'
liveness_case 'reports NO-GO through stageCodeReview when the re-opened task has no gate'
liveness_case 'reports NO-GO through stageUatReview too'
liveness_case 'diagnoses a task carrying a REVIEW FINDING note'
liveness_case 'tells the diagnostician the build is green and asks for a gate per fix'
liveness_case 'the doc block must immediately precede'
if grep -q 'call === 1 ? before : after' "$SUITE_LIVENESS"; then
  fail "loadTaskStateReturns is call-counting again — stageCodeReview reads tasks.json before dispatch, so call 1 is not the snapshot"
fi

# ── T001's deliverable: the contract is asserted on the artifact the runtime
#    dispatches, so the suite resolves PROMPT.md from the repo root, never from
#    its own directory.
[ -f "$SUITE_PROMPTS" ] || fail "file not found: $SUITE_PROMPTS"
if grep -q 'path.join(HERE, "review-code' "$SUITE_PROMPTS"; then
  fail "$SUITE_PROMPTS resolves PROMPT.md relative to itself again; it must resolve from the repo root and cover dist/"
fi
grep -q 'REPO_ROOT' "$SUITE_PROMPTS" || fail "$SUITE_PROMPTS no longer resolves from the repo root"

# ── T002's deliverable: TR-012 drives the entry points `gwrk ship` calls, not
#    only `executeReviewWorkflow`. Both stages read tasks.json before dispatch.
[ -f "$SUITE_LIVENESS" ] || fail "file not found: $SUITE_LIVENESS"
grep -q 'orchestrator.stageCodeReview()' "$SUITE_LIVENESS" || fail "no case drives stageCodeReview"
grep -q 'orchestrator.stageUatReview()' "$SUITE_LIVENESS" || fail "no case drives stageUatReview"
grep -q 'dispatchToAgent).mock.calls.length > 0' "$SUITE_LIVENESS" \
  || fail "the state mock is no longer keyed off the dispatch"

echo "PASS: phase-01 — the prompt contract holds on src/ and dist/, and a review finding survives to the verdict through every entry point"
