#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T007 — Modify ship-orchestrator.ts (TR-010; FR-010, US-005, SC-006)
#
# `runTaskGate` strategy 1 prefers this file over T007's declared `gateScript`
# (src/utils/gate-exec.ts:64-74), which is why the previous version — `test -f`
# plus one `pnpm vitest run src/engine/ship-orchestrator.test.ts` — printed
# "PASS: T007" having run zero FR-010 assertions: that suite touches none of it,
# and the Phase 04 Done-When block T007 declared never executed. This file
# delegates to the phase baseline, and so does T007's `gateScript`.

bash "$(dirname "$0")/phase-04-contract.sh"
