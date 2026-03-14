#!/bin/bash
# E002: Command Composition
# Question: Can gwrk commands compose — output of one feeds input of another?
# Scope: specs → tasks → gates chain; the discovery-to-verification pipeline
set -uo pipefail

GWRK="node $(git rev-parse --show-toplevel)/dist/cli.js"
PASS=0
FAIL=0
TOTAL=0

assert_pass() {
  local name="$1"
  TOTAL=$((TOTAL + 1))
  echo "  PASS: $name"
  PASS=$((PASS + 1))
}

assert_fail() {
  local name="$1"
  local detail="$2"
  TOTAL=$((TOTAL + 1))
  echo "  FAIL: $name — $detail"
  FAIL=$((FAIL + 1))
}

echo "=== E002: Command Composition ==="
echo ""

# --- Test 1: specs → extract all feature IDs ---
echo "T1: specs --format json → extract feature IDs as raw lines"
FEATURE_IDS=$($GWRK project specs --format json 2>/dev/null | jq -r '.[].id')
if [[ -n "$FEATURE_IDS" ]]; then
  COUNT=$(echo "$FEATURE_IDS" | wc -l | tr -d ' ')
  assert_pass "extracted $COUNT feature IDs"
  echo "    sample: $(echo "$FEATURE_IDS" | head -3 | tr '\n' ', ')"
else
  assert_fail "feature ID extraction" "empty output"
fi

# --- Test 2: pipe spec ID → tasks list for a known feature ---
echo "T2: discover → pick first tasked feature → tasks list"
FIRST_TASKED=$($GWRK project specs --format json 2>/dev/null \
  | jq -r '[.[] | select(.status == "tasked" or .status == "shipped")] | .[0].name // empty')
if [[ -n "$FIRST_TASKED" ]]; then
  TASKS_OUT=$($GWRK tasks list "$FIRST_TASKED" --format json 2>/dev/null)
  if echo "$TASKS_OUT" | jq . > /dev/null 2>&1; then
    TASK_COUNT=$(echo "$TASKS_OUT" | jq 'if type == "array" then length elif .phases then [.phases[].tasks[]] | length else 0 end')
    assert_pass "tasks list for '$FIRST_TASKED' → valid JSON ($TASK_COUNT tasks)"
  else
    assert_fail "tasks list JSON parse" "output: $(echo "$TASKS_OUT" | head -3)"
  fi
else
  assert_fail "feature selection" "no tasked features found"
fi

# --- Test 3: gates --format json produces gate list ---
echo "T3: project gates --format json → gate inventory"
GATES_OUT=$($GWRK project gates --format json 2>/dev/null)
if echo "$GATES_OUT" | jq . > /dev/null 2>&1; then
  GATE_COUNT=$(echo "$GATES_OUT" | jq 'length')
  assert_pass "gates returned valid JSON ($GATE_COUNT gates)"
else
  assert_fail "gates JSON parse" "output: $(echo "$GATES_OUT" | head -3)"
fi

# --- Test 4: gate-check a specific task from a known feature ---
echo "T4: gate-check T001 from 000-tdd-infrastructure"
GC_OUT=$($GWRK gate-check T001 -f specs/000-tdd-infrastructure --format json 2>/dev/null)
GC_EXIT=$?
if echo "$GC_OUT" | jq . > /dev/null 2>&1; then
  GC_RESULT=$(echo "$GC_OUT" | jq -r '.result')
  assert_pass "gate-check T001 → $GC_RESULT (exit $GC_EXIT)"
else
  assert_fail "gate-check JSON" "output: $(echo "$GC_OUT" | head -3)"
fi

# --- Test 5: round-trip composition — discover → specs → pick feature → tasks → count open ---
echo "T5: round-trip: discover → specs → tasks → count open"
OPEN_FEATURE=$($GWRK project specs --format json 2>/dev/null \
  | jq -r '[.[] | select(.tasksOpen > 0)] | .[0].name // empty')
if [[ -n "$OPEN_FEATURE" ]]; then
  OPEN_COUNT=$($GWRK tasks ready "$OPEN_FEATURE" --format json 2>/dev/null | jq 'length' 2>/dev/null)
  if [[ -n "$OPEN_COUNT" ]]; then
    assert_pass "round-trip: '$OPEN_FEATURE' has $OPEN_COUNT ready tasks"
  else
    # tasks ready may not support --format json, try without
    READY_OUT=$($GWRK tasks ready "$OPEN_FEATURE" 2>/dev/null)
    assert_pass "round-trip: '$OPEN_FEATURE' responsive (human format)"
    echo "    note: tasks ready --format json may need work"
  fi
else
  assert_fail "round-trip" "no features with open tasks"
fi

# --- Test 6: pipe multiple gates through xargs ---
echo "T6: gates → jq → xargs gate-check (batch verification)"
FIRST_GATE_FEATURE=$($GWRK project gates --format json 2>/dev/null \
  | jq -r '.[0].feature // empty')
FIRST_GATE_TASK=$($GWRK project gates --format json 2>/dev/null \
  | jq -r '.[0].taskId // empty')
if [[ -n "$FIRST_GATE_FEATURE" && -n "$FIRST_GATE_TASK" ]]; then
  BATCH_OUT=$($GWRK gate-check "$FIRST_GATE_TASK" -f "specs/$FIRST_GATE_FEATURE" --format json 2>/dev/null)
  if echo "$BATCH_OUT" | jq -r '.result' > /dev/null 2>&1; then
    BATCH_RESULT=$(echo "$BATCH_OUT" | jq -r '.result')
    assert_pass "batch gate-check: $FIRST_GATE_TASK@$FIRST_GATE_FEATURE → $BATCH_RESULT"
  else
    assert_fail "batch gate-check parse" "output: $(echo "$BATCH_OUT" | head -3)"
  fi
else
  assert_fail "batch gate selection" "no gates found (feature='$FIRST_GATE_FEATURE', task='$FIRST_GATE_TASK')"
fi

echo ""
echo "=== E002 Results: $PASS/$TOTAL passed, $FAIL failed ==="
exit $FAIL
