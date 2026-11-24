#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
test -f src/ci-test-policy.test.ts
test -f src/architecture.test.ts
test -f src/server/e2e.test.ts
test -f src/server/integration.test.ts
test -f src/server/routes/dispatch.test.ts
test -f src/server/routes/notify.test.ts
test -f src/cli.pulse.e2e.test.ts
test -f src/engine/pulse-integration.test.ts
pnpm run build
pnpm exec vitest run src/ci-test-policy.test.ts src/architecture.test.ts
CI=true pnpm run test:ci --retry 0 src/server/e2e.test.ts src/server/integration.test.ts src/server/routes/dispatch.test.ts src/server/routes/notify.test.ts src/cli.pulse.e2e.test.ts src/engine/pulse-integration.test.ts
CI=true pnpm run test:ci
