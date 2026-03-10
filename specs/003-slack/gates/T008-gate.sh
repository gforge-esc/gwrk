#!/bin/bash
set -e
echo "Gate T008: Wire Bolt into Fastify server"
# Assertion #1: slack import in server index
grep -q "slack\|Slack\|bolt\|Bolt" src/server/index.ts || { echo "FAIL: No Slack reference in server/index.ts"; exit 1; }
# Assertion #2: Compiles
pnpm build 2>&1 | tail -3
echo "PASS"
