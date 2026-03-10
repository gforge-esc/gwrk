#!/bin/bash
set -e
echo "Gate T001: @slack/bolt dependency"
# Assertion #1: @slack/bolt in package.json
grep -q '"@slack/bolt"' package.json || { echo "FAIL: @slack/bolt not in package.json"; exit 1; }
# Assertion #2: node_modules/@slack/bolt exists
test -d node_modules/@slack/bolt || { echo "FAIL: @slack/bolt not installed"; exit 1; }
echo "PASS"
