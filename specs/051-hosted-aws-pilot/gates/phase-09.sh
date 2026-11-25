#!/usr/bin/env bash
set -euo pipefail
# AUTHORED against the approved production authentication contract.
# Missing tests deny completion before the behavioral commands run.
if [[ "${GWRK_OPERATOR_LIVE_ACCEPTANCE:-}" != 1 ]]; then
  echo "FAIL: live acceptance requires the authorized coordinator" >&2
  exit 1
fi
if [[ ! -f tests/hosted-pilot/live-acceptance-gate.mjs ]]; then
  echo 'FAIL: required behavioral test is missing: tests/hosted-pilot/live-acceptance-gate.mjs' >&2
  exit 1
fi
node --input-type=module -e '
import assert from "node:assert/strict";
import { runLiveAcceptanceGate } from "./tests/hosted-pilot/live-acceptance-gate.mjs";
const target = process.env.GWRK_LIVE_ACCEPTANCE_TARGET || "https://gwrk.gforge.ai";
await runLiveAcceptanceGate({
  args: ["--mode=live", `--target=${target}`, "--record=specs/051-hosted-aws-pilot/evidence/live-acceptance.md"],
  env: process.env,
  probeFn: async (healthUrl) => {
    const u = new URL(healthUrl);
    const privRes = await fetch(`${u.origin}/health`, { signal: AbortSignal.timeout(10000) });
    assert.equal(privRes.status, 404, "Public /health must remain unrouted (404) at Traefik edge");
    const apiRes = await fetch(`${u.origin}/api/health`, { signal: AbortSignal.timeout(10000) });
    assert.equal(apiRes.status, 401, "Public /api/health must require authentication (401)");
  },
});
'
