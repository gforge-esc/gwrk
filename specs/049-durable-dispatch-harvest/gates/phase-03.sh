#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
required_tests=(src/server/slack-durable-notify.test.ts src/adapters/notifications/slack-receipt-reader.test.ts src/adapters/notifications/outbox-adapter.integration.test.ts src/adapters/git/harvest-git.test.ts src/adapters/github/github-adapter.test.ts src/adapters/notifications/outbox-reconcile.test.ts src/architecture.test.ts)
for test_file in "${required_tests[@]}"; do
  if [[ ! -f "$test_file" ]]; then
    echo "Missing required test: $test_file" >&2
    exit 1
  fi
done
pnpm build
pnpm lint
pnpm exec vitest run src/server/slack-durable-notify.test.ts src/adapters/notifications/slack-receipt-reader.test.ts src/adapters/notifications/outbox-adapter.integration.test.ts src/adapters/git/harvest-git.test.ts src/adapters/github/github-adapter.test.ts src/adapters/notifications/outbox-reconcile.test.ts src/architecture.test.ts
