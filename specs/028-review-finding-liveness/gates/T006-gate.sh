#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T006 — Create returned-verdict.ts (TR-010; FR-010, US-005, TC-002, TC-006, SC-006)
#
# There was no T006 gate file, so `runTaskGate` fell through to T006's declared
# `gateScript`: `test -f` plus five static greps, every one of which passed over
# a parser that fired on 0 of the 21 real transcripts carrying an
# agent-returned NO-GO. Nothing static can see a regex that never matches. This
# file delegates to the phase baseline, whose last section runs the BUILT parser
# against the stdout shapes the adapters actually emit; T006's `gateScript`
# delegates here.

bash "$(dirname "$0")/phase-04-contract.sh"
