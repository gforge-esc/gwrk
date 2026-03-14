#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
for c in ship implement branch wud; do
  test -f "specs/004-ship-loop/contracts/${c}.md" || { echo "FAIL: contract ${c}.md missing"; exit 1; }
done
grep -qE 'digest|phase.skip|phase-skip' specs/004-ship-loop/contracts/ship.md || { echo "FAIL: ship contract outdated"; exit 1; }
grep -qE 'emit_event|staging|validate' specs/004-ship-loop/contracts/implement.md || { echo "FAIL: implement contract outdated"; exit 1; }
grep -qE 'dirty|fail.fast|porcelain' specs/004-ship-loop/contracts/branch.md || { echo "FAIL: branch contract outdated"; exit 1; }
echo "PASS: T010 — contracts reflect implementation"
