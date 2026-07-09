#!/bin/bash
set -euo pipefail
# AUTHORED

# Verify manifests utility exists and has core functions
test -f src/utils/manifest.ts \
  || { echo "FAIL: T009 — file not found: src/utils/manifest.ts" >&2; exit 1; }
grep -q 'export function writeManifest' src/utils/manifest.ts \
  || { echo "FAIL: T009 — src/utils/manifest.ts missing 'writeManifest'" >&2; exit 1; }
grep -q 'export function loadManifests' src/utils/manifest.ts \
  || { echo "FAIL: T009 — src/utils/manifest.ts missing 'loadManifests'" >&2; exit 1; }

# Verify ship and define commands call writeManifest
grep -q 'writeManifest' src/commands/ship.ts \
  || { echo "FAIL: T009 — src/commands/ship.ts missing 'writeManifest' call" >&2; exit 1; }
grep -q 'writeManifest' src/commands/define.ts \
  || { echo "FAIL: T009 — src/commands/define.ts missing 'writeManifest' call" >&2; exit 1; }

# Verify tasks verify subcommand exists
grep -q 'command("verify <feature>")' src/commands/tasks.ts \
  || { echo "FAIL: T009 — src/commands/tasks.ts missing 'verify' subcommand" >&2; exit 1; }

# Verify .gitattributes merge protection
grep -q 'tasks.json merge=ours' .gitattributes \
  || { echo "FAIL: T009 — .gitattributes missing merge=ours for tasks.json" >&2; exit 1; }
grep -q 'runs/\*.json merge=binary' .gitattributes \
  || { echo "FAIL: T009 — .gitattributes missing merge=binary for manifests" >&2; exit 1; }

# Verify history.jsonl deprecation
grep -q 'history.jsonl is deprecated' src/utils/history.ts \
  || { echo "FAIL: T009 — src/utils/history.ts should mention deprecation" >&2; exit 1; }

echo "PASS: T009 — State Contract (Manifests & Merge Safety) verified"
