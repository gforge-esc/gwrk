#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T001 — Create the prompt-contract suite (TR-003; FR-003, FR-004, TC-005, TC-007)
#
# `runTaskGate` strategy 1 prefers this file over T001's declared `gateScript`
# (src/utils/gate-exec.ts:64-74), so this file is the executed artifact. It
# delegates to the phase baseline, and T001's `gateScript` — and plan.md's
# fenced `#### Done When` — delegate to the same script: declared, planned and
# executed are the same assertions, with nothing left to drift into dead text.

bash "$(dirname "$0")/phase-01-contract.sh"
