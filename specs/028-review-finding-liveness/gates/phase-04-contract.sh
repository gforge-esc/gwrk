#!/bin/bash
set -euo pipefail
# AUTHORED
# Phase 04 baseline — 028-review-finding-liveness (T006, T007), FR-010 / TR-010.
#
# `runTaskGate` strategy 1 always prefers `gates/<id>-gate.sh` when it exists
# (src/utils/gate-exec.ts:64-74), so the FILE is the executed artifact and a
# task's declared `gateScript` never runs beside it. The previous T007 gate —
# `test -f` plus `pnpm vitest run ship-orchestrator.test.ts` — asserted nothing
# about FR-010, and T006 had no gate file at all, so strategy 1 fell through to
# a `gateScript` of five static greps. Both were green while the ratchet was
# dead code: `parseReturnedVerdict` scanned raw stream-json, where every inner
# quote is backslash-escaped, and fired on 0 of the 21 real transcripts that
# carry an agent-returned NO-GO. Nothing static can see that.
#
# So the last section of this file is executable: it feeds the BUILT parser the
# byte shapes the adapters actually emit and checks what comes back. This file
# runs Phase 04's `#### Done When` block verbatim first, `gates/T006-gate.sh`
# and `gates/T007-gate.sh` delegate here, and both `gateScript` fields delegate
# to their gate: declared, planned and executed are the same assertions, with
# nothing left to drift into dead text.
#
# Location-independent: resolve the repo root from this script, not from $PWD.

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$REPO_ROOT"

PARSER="src/engine/returned-verdict.ts"
ORCH="src/engine/ship-orchestrator.ts"
SUITE_LIVENESS="src/engine/ship-orchestrator.review-finding-liveness.test.ts"
SUITE_DIVERGENCE="src/engine/ship-orchestrator.review-gate-divergence.test.ts"

fail() { echo "FAIL: phase-04 — $1" >&2; exit 1; }

# ── plan.md > Phase 04 > Done When, command for command.

# 1. Build. dist/ is what `gwrk ship` dispatches, and it is what the behavioural
#    section below loads — a source-only pass would prove nothing about the
#    binary that runs.
npm run build || fail "npm run build"

# 2-3. `npx`, not `pnpm`: `pnpm vitest` re-resolves the store and aborts on
#      `pnpm install` when there is no TTY.
npx vitest run "$SUITE_LIVENESS" || fail "vitest: $SUITE_LIVENESS"
npx vitest run "$SUITE_DIVERGENCE" || fail "vitest: $SUITE_DIVERGENCE"

# 4. The parser exists.
test -f "$PARSER" || fail "file not found: $PARSER"

# 5. TC-006 enforced in the signature: a returned GO must be unrepresentable.
grep -q '"NO-GO" | undefined' "$PARSER" || fail "$PARSER: the TC-006 return type is gone — a returned GO is representable again"

# 6. The ratchet is wired into the orchestrator, not merely written.
grep -q 'parseReturnedVerdict' "$ORCH" || fail "$ORCH: the returned verdict is read by nobody again"

# 7-9. The three named TR-010 cases. A `-t` filter exits 0 on no match, so
#      assert against the test source instead of asking vitest to select them.
liveness_case() {
  grep -q "$1" "$SUITE_LIVENESS" || fail "$SUITE_LIVENESS lost the TR-010 case: $1"
}

liveness_case 'a returned NO-GO forces NO-GO'
liveness_case 'a returned GO never overrides re-open evidence'
liveness_case 'an absent or unparseable verdict does not fail the run'

# ── Beyond Done When: the coverage hole that let a dead ratchet ship green.
#
# Every assertion above passed over a parser that never fired in production,
# because none of them ran it. These do, against dist/, on the exact stdout
# shapes `TaskResult.stdout` carries: `agent.ts` joins the backend's raw lines
# and `ClaudeAdapter.parseResult` returns them verbatim, so on the claude
# backend the agent's JSON is a string value inside a stream-json envelope and
# every inner quote arrives escaped.

test -f dist/engine/returned-verdict.js || fail "dist/engine/returned-verdict.js missing after build"

node --input-type=module -e '
const { parseReturnedVerdict } = await import(process.cwd() + "/dist/engine/returned-verdict.js");
const say = (t) => JSON.stringify({ type: "result", subtype: "success", is_error: false, result: t });
const said = (t) => JSON.stringify({ type: "assistant", message: { role: "assistant", type: "message", content: [{ type: "text", text: t }] } });
const read = (t) => JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: t }] } });
const AGENT_JSON = "{\"summary\":\"reproduced\",\"verdict\":\"NO-GO\",\"reopenedTasks\":[]}";

const must = [
  // FR-010 on the backend gwrk ship runs: the stream-json envelope.
  ["result envelope", say(AGENT_JSON), "NO-GO"],
  ["assistant text block", said(AGENT_JSON), "NO-GO"],
  ["full event stream", [JSON.stringify({type:"system",subtype:"init"}), said(AGENT_JSON), say(AGENT_JSON)].join("\n"), "NO-GO"],
  // A clipped terminal result event still carries a legible verdict.
  ["clipped result envelope", "{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"{\\\"verdict\\\": \\\"NO-GO\\\", \\\"summary\\\": \\\"clipped", "NO-GO"],
  // Prose backends (agy, codex) set no emitsStreamJson and print bare text.
  ["plain prose", AGENT_JSON, "NO-GO"],
  ["fenced prose", "Review done.\n```json\n{\n  \"verdict\": \"NO-GO\"\n}\n```", "NO-GO"],
  // TC-006: a returned GO is not a signal, in any shape.
  ["returned GO, envelope", say("{\"verdict\":\"GO\"}"), undefined],
  ["returned GO, prose", "{\"verdict\":\"GO\"}", undefined],
  // The false positive that rules out simply widening the regex over the raw
  // transcript: a review agent reads spec.md and plan.md every run, and both
  // contain the literal pair. Quoted bytes are not testimony.
  ["tool_result carrying spec.md", read("  174\t  \"verdict\": \"NO-GO\",\n"), undefined],
  ["tool_use grepping for the pair", JSON.stringify({ type: "assistant", message: { role: "assistant", type: "message", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "grep -rn \x27\"verdict\": \"NO-GO\"\x27 ." } }] } }), undefined],
  // TC-002: never a new way for a run to die, and never a verdict from noise.
  ["empty", "", undefined],
  ["junk", "{{{ not json at all", undefined],
  ["no verdict field", say("{\"summary\":\"all clear\"}"), undefined],
  ["prompt gloss in backticks", said("`verdict`: \"GO\" if all checks pass, \"NO-GO\" otherwise."), undefined],
];

let bad = 0;
for (const [name, stdout, want] of must) {
  let got;
  try { got = parseReturnedVerdict(stdout); }
  catch (e) { console.error(`  THREW on ${name}: ${e.message} (TC-002)`); bad++; continue; }
  if (got !== want) { console.error(`  ${name}: expected ${String(want)}, got ${String(got)}`); bad++; }
}
if (bad) { console.error(`${bad}/${must.length} stdout-shape assertions failed`); process.exit(1); }
console.log(`  parser: ${must.length}/${must.length} real stdout shapes correct (stream-json + prose)`);
' || fail "the built parser does not read the stdout shape the adapters emit (FR-010 / SC-006)"

# The suite must keep driving the ratchet through an envelope, not a bare
# string. A fixture that models only the convenient shape is how the previous
# 45/45 green was reached over a ratchet production could never reach.
grep -q 'type: "result"' "$SUITE_LIVENESS" || fail "$SUITE_LIVENESS no longer mocks stdout as a stream-json envelope — TR-010 is back to asserting a shape no adapter emits"
liveness_case 'captured from a real transcript'
liveness_case 'tool_result carrying spec.md bytes'
liveness_case 'the ratchet is live for the uat-review stage too'

echo "PASS: phase-04 — the returned NO-GO ratchets one way, on the stdout both backends actually emit"
