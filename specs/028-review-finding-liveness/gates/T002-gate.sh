#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T002 — Update ship-orchestrator.review-finding-liveness.test.ts
#              (TR-006, TR-007, TR-012; FR-006, FR-007, FR-008)
#
# `runTaskGate` strategy 1 prefers this file over T002's declared `gateScript`,
# which is why the previous version — `test -f` plus one vitest run — stayed
# green while `REVIEW FINDING|` was deleted from the DIAGNOSE filter and every
# assertion declared in `gateScript` sat unexecuted. Both Phase 01 gates now
# delegate to one baseline, and so do both `gateScript` fields.

bash "$(dirname "$0")/phase-01-contract.sh"
