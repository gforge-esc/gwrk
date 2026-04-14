#!/bin/bash
set -euo pipefail
# Gate: T024 — Implement src/server/heartbeat.ts

grep -q "build plan health" src/server/heartbeat.ts

echo "PASS: T024 — Heartbeat monitoring wired"
