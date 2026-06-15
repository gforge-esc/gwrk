#!/usr/bin/env bash
# Gate: detect duplicate exported names across source modules.
# Two exports with the same name in different files = type collision risk.
# Run: ./scripts/lint-exports.sh
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

dupes=$(grep -rn "^export " src/ --include="*.ts" \
  | grep -v ".test.ts" \
  | grep -v "dist/" \
  | perl -ne 'print "$1\n" if /export\s+(?:async\s+)?(?:function|const|class|type|interface|enum)\s+(\w+)/' \
  | sort \
  | uniq -d)

if [ -n "$dupes" ]; then
  echo "🔴 DUPLICATE EXPORT NAMES DETECTED:"
  echo ""
  for name in $dupes; do
    echo "  $name:"
    grep -rn "^export.*\b${name}\b" src/ --include="*.ts" \
      | grep -v ".test.ts" \
      | grep -v "dist/" \
      | sed 's/^/    /'
  done
  echo ""
  echo "Fix: rename one of each pair to eliminate ambiguity."
  exit 1
fi

echo "✅ No duplicate export names found."
