#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T003 — Modify ship-orchestrator.ts (TR-008; FR-008, US-004, SC-005)
#
# `runTaskGate` strategy 1 prefers this file over T003's declared `gateScript`
# (src/utils/gate-exec.ts:63-74), which is why the previous version — `test -f`
# plus one `pnpm vitest run src/engine/ship-orchestrator.test.ts` — ran green on
# a worktree at cad1f86, the commit immediately BEFORE Phase 02, where neither
# `ReviewFindings` nor `descriptionOnly` appears anywhere in the orchestrator.
# That suite never touches `detectReviewReopens`. This file now delegates to the
# phase baseline, and so does T003's `gateScript`.

bash "$(dirname "$0")/phase-02-contract.sh"
