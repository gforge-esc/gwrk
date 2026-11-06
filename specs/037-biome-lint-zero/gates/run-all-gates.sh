#!/usr/bin/env bash
set -euo pipefail

echo "═══ Running 037-biome-lint-zero gates ═══"
pnpm lint
echo "✅ 037-biome-lint-zero gates passed."
