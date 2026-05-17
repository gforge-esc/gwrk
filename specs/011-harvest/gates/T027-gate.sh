#!/bin/bash
# AUTHORED
set -euo pipefail

# Task has no file, cannot be gated.
echo "FAIL: T027 — cannot gate: no primary file specified for test strategy" >&2
exit 1
