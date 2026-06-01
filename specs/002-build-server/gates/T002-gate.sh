#!/bin/bash
# AUTHORED
set -euo pipefail
test -f src/commands/server-install.ts || { echo "FAIL: T002 — file not found: src/commands/server-install.ts" >&2; exit 1; }
grep -q "export const installServer" src/commands/server-install.ts || { echo "FAIL: T002 — src/commands/server-install.ts missing 'installServer'" >&2; exit 1; }
grep -q "export const uninstallServer" src/commands/server-install.ts || { echo "FAIL: T002 — src/commands/server-install.ts missing 'uninstallServer'" >&2; exit 1; }
grep -q "export const getLogs" src/commands/server-install.ts || { echo "FAIL: T002 — src/commands/server-install.ts missing 'getLogs'" >&2; exit 1; }
echo "PASS: T002 — Implement src/commands/server-install.ts"