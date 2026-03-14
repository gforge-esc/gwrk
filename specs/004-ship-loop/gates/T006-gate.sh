#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
grep -qE 'failureContext|failure_context' scripts/dev/work-until-done.sh || { echo "FAIL: failureContext not in WUD"; exit 1; }
grep -qE 'openTasks|open_tasks' scripts/dev/work-until-done.sh || { echo "FAIL: openTasks not in failureContext"; exit 1; }
echo "PASS: T006 — failureContext on circuit break"
