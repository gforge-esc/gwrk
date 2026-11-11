#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
tests=(src/adapters/models/catalog-discovery.test.ts src/adapters/models/smoke-probe.test.ts src/utils/agent.test.ts src/plugins/builtins/agents/agy/adapter.test.ts src/architecture.test.ts src/plugins/builtins/agents/claude/adapter.test.ts src/plugins/builtins/agents/codex/adapter.test.ts)
for test_file in "${tests[@]}"; do
  if [[ ! -f "$test_file" ]]; then
    echo "Missing required test: $test_file" >&2
    exit 1
  fi
done
pnpm build
pnpm exec vitest run "${tests[@]}"
