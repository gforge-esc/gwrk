#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
pnpm build
pnpm exec vitest run \
  src/db/scoping.test.ts \
  src/db/db.test.ts \
  src/db/plan.test.ts \
  src/db/runs.test.ts \
  src/db/issues.test.ts \
  src/db/compression.test.ts \
  src/commands/ship.test.ts \
  src/commands/runs.test.ts \
  src/server/backend-selector.integration.test.ts \
  src/adapters/sqlite/store-isolation.test.ts \
  src/architecture.test.ts
