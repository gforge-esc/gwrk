#!/usr/bin/env bash
# Gate: T002 — Extend GwrkConfigSchema for server and parallelism
set -euo pipefail

# Assertion #1: src/utils/config.ts exists
test -f src/utils/config.ts || { echo "FAIL: src/utils/config.ts not found"; exit 1; }

# Assertion #2: server schema exists
grep -q "server:" src/utils/config.ts || { echo "FAIL: server section missing in GwrkConfigSchema"; exit 1; }

# Assertion #3: parallelism schema exists
grep -q "parallelism:" src/utils/config.ts || { echo "FAIL: parallelism section missing in GwrkConfigSchema"; exit 1; }

# Assertion #4: local/cloud sub-sections exist
grep -q "local:" src/utils/config.ts && grep -q "cloud:" src/utils/config.ts || { echo "FAIL: parallelism.local or parallelism.cloud missing"; exit 1; }

# Assertion #5: maxClones/maxCpu/maxMem/minDiskGb exist
grep -q "maxClones" src/utils/config.ts && grep -q "maxCpu" src/utils/config.ts && grep -q "maxMem" src/utils/config.ts && grep -q "minDiskGb" src/utils/config.ts || { echo "FAIL: parallelism.local fields missing"; exit 1; }

echo "PASS: T002"
