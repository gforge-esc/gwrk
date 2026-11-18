#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
test -f src/db/db.test.ts
test -f src/db/compression.test.ts
test -f src/adapters/sqlite/store-isolation.test.ts
test -f src/architecture.test.ts
pnpm run build
pnpm exec vitest run src/db/db.test.ts src/db/compression.test.ts src/adapters/sqlite/store-isolation.test.ts src/architecture.test.ts
