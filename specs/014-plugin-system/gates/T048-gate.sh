#!/bin/bash
set -euo pipefail
# AUTHORED

# FAIL: T048 — cannot gate: no primary file or test commands provided in the task brief
echo "FAIL: T048 — cannot gate: no primary file or test commands provided in the task brief" >&2
exit 1
