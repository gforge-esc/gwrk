#!/bin/bash
set -e
echo "Gate T017: Interactive action handlers"
# Assertion #1: File exists
test -f src/server/slack-actions.ts || { echo "FAIL: src/server/slack-actions.ts not found"; exit 1; }
# Assertion #2: Merge action
grep -q "merge\|Merge\|merge_pr" src/server/slack-actions.ts || { echo "FAIL: No merge action handler"; exit 1; }
# Assertion #3: Reaction handler
grep -q "reaction\|Reaction\|reaction_added" src/server/slack-actions.ts || { echo "FAIL: No reaction handler"; exit 1; }
# Assertion #4: gh pr merge reference
grep -q "gh.*pr.*merge\|pr.*merge\|mergePR" src/server/slack-actions.ts || { echo "FAIL: No gh pr merge reference"; exit 1; }
echo "PASS"
