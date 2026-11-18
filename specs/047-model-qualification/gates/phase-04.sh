#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
tests=(src/adapters/models/route-lock-store.test.ts src/commands/models.test.ts src/cli.consistency.test.ts src/cli.option-collisions.test.ts src/cli.ux.test.ts src/architecture.test.ts)
for test_file in "${tests[@]}"; do
  if [[ ! -f "$test_file" ]]; then
    echo "Missing required test: $test_file" >&2
    exit 1
  fi
done
pnpm build
pnpm exec vitest run "${tests[@]}"
