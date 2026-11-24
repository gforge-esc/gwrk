#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
set -euo pipefail
tests=(src/server/dispatch.test.ts src/server/persistence.test.ts src/server/harvest-watcher.test.ts src/server/heartbeat.test.ts src/server/routes/notify.test.ts src/server/routes/health.test.ts src/server/routes/status.test.ts src/server/github.test.ts src/architecture.test.ts)
for test_file in "${tests[@]}"; do
  test -f "$test_file" || { echo "Missing required test: $test_file" >&2; exit 1; }
done
pnpm build
pnpm exec vitest run "${tests[@]}"
