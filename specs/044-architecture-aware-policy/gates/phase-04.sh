#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
tests=(
  src/application/architecture/context.test.ts
  src/commands/init.test.ts
  src/utils/agent.test.ts
  src/utils/agent.policy-binding.test.ts
  src/utils/agent.grounding-decisions.test.ts
  src/plugins/workflow-runtime.test.ts
  src/architecture.test.ts
)
for test_file in "${tests[@]}"; do
  if [[ ! -f "$test_file" ]]; then
    echo "Missing required test: $test_file" >&2
    exit 1
  fi
done
test -f scripts/architecture-context-uat.py
pnpm build
pnpm exec vitest run "${tests[@]}"
python3 scripts/architecture-context-uat.py
