#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T009 — Update ship-orchestrator.review-finding-liveness.test.ts
#          (TR-012; VR-001…VR-007, SC-008, US-001)
#
# `runTaskGate` strategy 1 prefers this file over T009's declared `gateScript`
# (src/utils/gate-exec.ts:63-73), which is why the previous version — `test -f`
# plus one `pnpm vitest run` on the very file it had just checked for — printed
# "PASS: T009" in 894ms while that `gateScript`, run verbatim, exited 1. It
# asserted 1 of 8 declared checks; VR-001…VR-007 were unexecuted text. This file
# now delegates to the phase baseline, and so does T009's `gateScript`.

bash "$(dirname "$0")/phase-06-contract.sh"
