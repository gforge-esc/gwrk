#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
test -f src/server/server-scope.test.ts
test -f src/server/e2e.test.ts
test -f src/server/integration.test.ts
test -f src/server/routes/dispatch.test.ts
test -f src/server/routes/notify.test.ts
test -f src/server/routes/status.test.ts
test -f src/server/dispatch.test.ts
test -f src/engine/harvest.test.ts
test -f src/adapters/sqlite/store-isolation.test.ts
test -f src/architecture.test.ts
pnpm run build
env -u GWRK_SKIP_INTEGRATION pnpm exec vitest run --retry 0 src/server/server-scope.test.ts src/server/e2e.test.ts src/server/integration.test.ts src/server/routes/dispatch.test.ts src/server/routes/notify.test.ts src/server/routes/status.test.ts src/server/dispatch.test.ts src/engine/harvest.test.ts src/adapters/sqlite/store-isolation.test.ts src/architecture.test.ts
