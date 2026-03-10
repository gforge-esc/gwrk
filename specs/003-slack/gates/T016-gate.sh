#!/bin/bash
set -e
echo "Gate T016: Slash command handlers"
# Assertion #1: File exists
test -f src/server/slack-commands.ts || { echo "FAIL: src/server/slack-commands.ts not found"; exit 1; }
# Assertion #2: status command
grep -q "status" src/server/slack-commands.ts || { echo "FAIL: No status command handler"; exit 1; }
# Assertion #3: dispatch command
grep -q "dispatch" src/server/slack-commands.ts || { echo "FAIL: No dispatch command handler"; exit 1; }
# Assertion #4: approve command
grep -q "approve" src/server/slack-commands.ts || { echo "FAIL: No approve command handler"; exit 1; }
# Assertion #5: CommandContext or handler interface
grep -q "CommandContext\|SlashCommandHandler\|handler" src/server/slack-commands.ts || { echo "FAIL: No handler interface"; exit 1; }
echo "PASS"
