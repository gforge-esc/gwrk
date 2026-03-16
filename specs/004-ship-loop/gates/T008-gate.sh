#!/bin/bash
set -euo pipefail
# Gate: T008 — Implement scripts/dev/wud-branch.sh
# Generated: assertions derived from plan Done When + file type.
# To override, add '# AUTHORED' anywhere and edit freely.

# Done When (from plan)
grep -qE 'porcelain|Dirty working tree' scripts/dev/wud-branch.sh

echo "PASS: T008 — Implement scripts/dev/wud-branch.sh"
