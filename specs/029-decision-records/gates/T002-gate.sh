#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T002 — Modify ADR-001-task-tracking.md
# TR-014 corpus assertions (plan.md Phase 1 > Done When). The corpus is markdown,
# not a vitest suite: `vitest run <file>.md` matches nothing under vitest's
# include glob (**/*.{test,spec}.?(c|m)[jt]s?(x)) and exits 1 with "No test files
# found", so this gate asserts the corpus properties directly instead.

test -f docs/decisions/ADR-001-task-tracking.md || { echo "FAIL: T002 — file not found: docs/decisions/ADR-001-task-tracking.md" >&2; exit 1; }

# FR/TR-014: H1 is the addressable `# ADR-001: <title>` form.
awk 'NR==1{exit !/^# ADR-001: /}' docs/decisions/ADR-001-task-tracking.md \
  || { echo "FAIL: T002 — line 1 of ADR-001-task-tracking.md is not '# ADR-001: <title>'" >&2; exit 1; }

# FR/TR-014: the duplicate `## 7.` heading is deduplicated, so section
# addressing is unambiguous.
test "$(grep -c '^## 7\.' docs/decisions/ADR-001-task-tracking.md)" = 1 \
  || { echo "FAIL: T002 — ADR-001-task-tracking.md must contain exactly one '## 7.' heading" >&2; exit 1; }

echo "PASS: T002 — Modify ADR-001-task-tracking.md"
