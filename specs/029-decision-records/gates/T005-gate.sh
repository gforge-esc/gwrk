#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T005 — Modify ADR-007-single-dispatch-path.md
# TR-014 corpus assertions (plan.md Phase 1 > Done When). The corpus is markdown,
# not a vitest suite: `vitest run <file>.md` matches nothing under vitest's
# include glob (**/*.{test,spec}.?(c|m)[jt]s?(x)) and exits 1 with "No test files
# found", so this gate asserts the corpus properties directly instead.

test -f docs/decisions/ADR-007-single-dispatch-path.md || { echo "FAIL: T005 — file not found: docs/decisions/ADR-007-single-dispatch-path.md" >&2; exit 1; }

# FR/TR-014: the record is no longer `Proposed`. Negative form per the plan's
# Gate-Form Correction (`! grep -q` is a set -e no-op).
if grep -q 'Status:\*\* Proposed' docs/decisions/ADR-007-single-dispatch-path.md; then
  echo "FAIL: T005 — ADR-007-single-dispatch-path.md still carries 'Status: Proposed'" >&2
  exit 1
fi

# The positive half: a deleted Status line must not read as a pass.
grep -q 'Status:\*\* Decided' docs/decisions/ADR-007-single-dispatch-path.md \
  || { echo "FAIL: T005 — ADR-007-single-dispatch-path.md has no 'Status: Decided' line" >&2; exit 1; }

# FR/TR-014 (W4): the inline `028 correction` block is present and states the
# one-way gate authority.
grep -q '028 correction' docs/decisions/ADR-007-single-dispatch-path.md \
  || { echo "FAIL: T005 — ADR-007-single-dispatch-path.md is missing the '028 correction' block" >&2; exit 1; }
grep -q 'is one-way' docs/decisions/ADR-007-single-dispatch-path.md \
  || { echo "FAIL: T005 — ADR-007 '028 correction' block is missing the 'is one-way' gate-authority statement" >&2; exit 1; }

echo "PASS: T005 — Modify ADR-007-single-dispatch-path.md"
