#!/bin/bash
set -euo pipefail
# Gate: T001 — Implement scripts/dev/work-until-done.sh
# Generated: assertions derived from plan Done When + file type.
# To override, add '# AUTHORED' anywhere and edit freely.

# Done When (from plan)
grep -q 'emit_event' scripts/dev/work-until-done.sh

echo "PASS: T001 — Implement scripts/dev/work-until-done.sh"
