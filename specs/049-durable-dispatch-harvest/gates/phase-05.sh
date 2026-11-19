#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
required_tests=(src/server/dispatch.test.ts src/server/github.test.ts src/server/routes/dispatch.test.ts src/server/slack-commands.test.ts src/server/slack-actions.test.ts src/architecture.test.ts)
for test_file in "${required_tests[@]}"; do
  if [[ ! -f "$test_file" ]]; then
    echo "Missing required test: $test_file" >&2
    exit 1
  fi
done
pnpm build
pnpm exec vitest run src/server/dispatch.test.ts src/server/github.test.ts src/server/routes/dispatch.test.ts src/server/slack-commands.test.ts src/server/slack-actions.test.ts src/architecture.test.ts
