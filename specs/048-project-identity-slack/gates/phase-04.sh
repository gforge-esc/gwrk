#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
set -euo pipefail
tests=(src/domain/slack-delivery.test.ts src/adapters/notifications/project-delivery.test.ts src/adapters/notifications/project-presence.test.ts src/server/slack-notify.test.ts src/server/slack-presence.test.ts src/server/telegram.test.ts src/server/slack-commands.test.ts src/architecture.test.ts)
for test_file in "${tests[@]}"; do
  test -f "$test_file" || { echo "Missing required test: $test_file" >&2; exit 1; }
done
pnpm build
pnpm exec vitest run "${tests[@]}"
