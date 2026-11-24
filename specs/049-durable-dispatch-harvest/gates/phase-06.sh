#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
required_tests=(src/commands/harvest.test.ts src/commands/status.test.ts src/server/routes/status.test.ts src/server/routes/health.test.ts src/server/unattended-recovery.test.ts src/server/index.test.ts src/server/two-repo-isolation.test.ts src/commands/project.test.ts src/commands/server.test.ts src/server/github.test.ts src/application/harvest/harvest-service.test.ts src/server/integration.test.ts src/architecture.test.ts)
for test_file in "${required_tests[@]}"; do
  if [[ ! -f "$test_file" ]]; then
    echo "Missing required test: $test_file" >&2
    exit 1
  fi
done
pnpm build
pnpm exec vitest run src/commands/harvest.test.ts src/commands/status.test.ts src/server/routes/status.test.ts src/server/routes/health.test.ts src/server/unattended-recovery.test.ts src/server/index.test.ts src/server/two-repo-isolation.test.ts src/commands/project.test.ts src/commands/server.test.ts src/server/github.test.ts src/application/harvest/harvest-service.test.ts src/server/integration.test.ts src/architecture.test.ts
