#!/bin/bash
set -e
echo "Gate T012: Block Kit message builders"
# Assertion #1: File exists
test -f src/server/slack-messages.ts || { echo "FAIL: src/server/slack-messages.ts not found"; exit 1; }
# Assertion #2: phaseStart builder
grep -q "phaseStart" src/server/slack-messages.ts || { echo "FAIL: No phaseStart builder"; exit 1; }
# Assertion #3: phaseComplete builder
grep -q "phaseComplete" src/server/slack-messages.ts || { echo "FAIL: No phaseComplete builder"; exit 1; }
# Assertion #4: phaseFail builder
grep -q "phaseFail" src/server/slack-messages.ts || { echo "FAIL: No phaseFail builder"; exit 1; }
# Assertion #5: doneDone builder
grep -q "doneDone" src/server/slack-messages.ts || { echo "FAIL: No doneDone builder"; exit 1; }
# Assertion #6: blocks array in output
grep -q "blocks" src/server/slack-messages.ts || { echo "FAIL: No blocks array in message shape"; exit 1; }
echo "PASS"
