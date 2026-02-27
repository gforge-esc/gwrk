#!/usr/bin/env bash
# Gate: T002 — Create spec parser for story extraction
# Contract: src/engine/spec-parser.ts must export extractStories()
set -euo pipefail

FILE="src/engine/spec-parser.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE does not exist" >&2; exit 1; }

# Assertion #2
grep -q 'export.*function extractStories' "$FILE" || \
# Assertion #3
grep -q 'export function extractStories' "$FILE" || \
  { echo "FAIL: extractStories function not exported" >&2; exit 1; }

# Assertion #4
grep -q 'StoryEstimate' "$FILE" || { echo "FAIL: StoryEstimate type not referenced" >&2; exit 1; }
# Assertion #5
grep -q 'spec.md not found' "$FILE" || { echo "FAIL: missing error message for spec.md not found" >&2; exit 1; }

echo "PASS: T002 — spec parser exports extractStories"
