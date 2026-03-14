#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
grep -q 'emit_event' scripts/dev/work-until-done.sh || { echo "FAIL: emit_event not found in WUD"; exit 1; }
grep -q '\.events' scripts/dev/work-until-done.sh || { echo "FAIL: .events sidecar not referenced"; exit 1; }
echo "PASS: T001 — emit_event with sidecar in WUD"
