#!/bin/bash
# E001: Pipe Chain Mechanics
# Question: Does gwrk output survive jq parsing through standard Unix pipes?
# Scope: gwrk project discover, specs — the read-only query surface
set -uo pipefail

GWRK="node $(git rev-parse --show-toplevel)/dist/cli.js"
PASS=0
FAIL=0
TOTAL=0

assert() {
  local name="$1"
  local actual="$2"
  local expected="$3"
  TOTAL=$((TOTAL + 1))
  if [[ "$actual" == "$expected" ]]; then
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name"
    echo "    expected: $expected"
    echo "    actual:   $actual"
    FAIL=$((FAIL + 1))
  fi
}

assert_nonempty() {
  local name="$1"
  local actual="$2"
  TOTAL=$((TOTAL + 1))
  if [[ -n "$actual" ]]; then
    echo "  PASS: $name → '$actual'"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name (empty output)"
    FAIL=$((FAIL + 1))
  fi
}

assert_numeric() {
  local name="$1"
  local actual="$2"
  TOTAL=$((TOTAL + 1))
  if [[ "$actual" =~ ^[0-9]+$ ]]; then
    echo "  PASS: $name → $actual"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name (not numeric: '$actual')"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== E001: Pipe Chain Mechanics ==="
echo ""

# --- Test 1: discover --format json produces valid JSON ---
echo "T1: discover --format json → valid JSON"
JSON=$($GWRK project discover --format json 2>/dev/null)
echo "$JSON" | jq . > /dev/null 2>&1
assert "valid JSON" "$?" "0"

# --- Test 2: extract project name via jq ---
echo "T2: discover → jq .project.name"
NAME=$($GWRK project discover --format json 2>/dev/null | jq -r '.project.name')
assert_nonempty "project name extracted" "$NAME"

# --- Test 3: extract spec count via jq ---
echo "T3: discover → jq '.specs | length'"
COUNT=$($GWRK project discover --format json 2>/dev/null | jq -r '.specs | length')
assert_numeric "spec count is numeric" "$COUNT"

# --- Test 4: specs --format json → extract first spec ID ---
echo "T4: specs --format json → jq '.[0].id'"
SPEC_ID=$($GWRK project specs --format json 2>/dev/null | jq -r '.[0].id')
assert_nonempty "first spec ID" "$SPEC_ID"

# --- Test 5: signal isolation — [exit:N] NOT in stdout ---
echo "T5: signal isolation (stderr only)"
STDOUT=$($GWRK project discover --format json 2>/dev/null)
if echo "$STDOUT" | grep -q '\[exit:'; then
  echo "  FAIL: signal leaked into stdout"
  FAIL=$((FAIL + 1))
  TOTAL=$((TOTAL + 1))
else
  echo "  PASS: signal stays on stderr"
  PASS=$((PASS + 1))
  TOTAL=$((TOTAL + 1))
fi

# --- Test 6: signal IS on stderr ---
echo "T6: signal present on stderr"
STDERR=$($GWRK project discover --format json 2>&1 1>/dev/null)
if echo "$STDERR" | grep -q '\[exit:'; then
  echo "  PASS: signal found on stderr → '$STDERR'"
  PASS=$((PASS + 1))
else
  echo "  FAIL: no signal on stderr"
  FAIL=$((FAIL + 1))
fi
TOTAL=$((TOTAL + 1))

# --- Test 7: git status in discovery JSON ---
echo "T7: discover → jq .project.git.branch"
BRANCH=$($GWRK project discover --format json 2>/dev/null | jq -r '.project.git.branch')
assert_nonempty "git branch extracted" "$BRANCH"

# --- Test 8: gates aggregate in discovery ---
echo "T8: discover → jq .gates.total"
GATES=$($GWRK project discover --format json 2>/dev/null | jq -r '.gates.total')
assert_numeric "gates total is numeric" "$GATES"

echo ""
echo "=== E001 Results: $PASS/$TOTAL passed, $FAIL failed ==="
exit $FAIL
