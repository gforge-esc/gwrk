#!/usr/bin/env bash
# Gate: T006 — Implement SystemMonitor resource sampling
set -euo pipefail

# Assertion #1: src/server/monitor.ts exists
test -f src/server/monitor.ts || { echo "FAIL: src/server/monitor.ts not found"; exit 1; }

# Assertion #2: SystemMonitor class exported
grep -q "export.*class SystemMonitor" src/server/monitor.ts || { echo "FAIL: SystemMonitor class not exported"; exit 1; }

# Assertion #3: sample() method exists
grep -q "sample()" src/server/monitor.ts || { echo "FAIL: sample() method missing"; exit 1; }

# Assertion #4: isThrottled() method exists
grep -q "isThrottled()" src/server/monitor.ts || { echo "FAIL: isThrottled() method missing"; exit 1; }

# Assertion #5: uses 'os' module for CPU/MEM
grep -q "import.*os" src/server/monitor.ts && grep -q "os.cpus()" src/server/monitor.ts && grep -q "os.freemem()" src/server/monitor.ts || { echo "FAIL: os module or sampling methods missing"; exit 1; }

# Assertion #6: uses 'df' for disk sampling
grep -q "df -BG" src/server/monitor.ts || { echo "FAIL: disk sampling via 'df' missing"; exit 1; }

echo "PASS: T006"
