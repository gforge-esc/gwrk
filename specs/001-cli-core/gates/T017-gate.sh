#!/bin/bash
set -euo pipefail
# Gate: T017 — History logger in src/utils/history.ts

test -f src/utils/history.ts
grep -q 'appendHistory' src/utils/history.ts
grep -q 'HistoryEntrySchema\|HistoryEntry' src/utils/history.ts
grep -q 'appendFileSync\|appendFile' src/utils/history.ts
grep -q 'history.jsonl' src/utils/history.ts

echo "PASS: T017 — history.ts appends validated JSONL entries"
