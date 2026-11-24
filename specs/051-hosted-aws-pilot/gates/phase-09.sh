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
node tests/hosted-pilot/live-acceptance-gate.mjs --mode=live --record specs/051-hosted-aws-pilot/evidence/live-acceptance.md
