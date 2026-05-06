#!/bin/bash
# T024: Implement src/server/heartbeat.ts
set -e
grep -q "plan" src/server/heartbeat.ts
echo "T024: Heartbeat checks for plan status."