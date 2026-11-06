#!/usr/bin/env bash
set -euo pipefail

echo "═══ Running 036-plugin-registry-versioning gates ═══"
npx vitest run src/engine/registry-versioning.test.ts src/plugins/loader-versioning.test.ts src/engine/registry.test.ts
echo "✅ 036-plugin-registry-versioning gates passed."
