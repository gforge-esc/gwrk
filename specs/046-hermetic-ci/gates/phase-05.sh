#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
test -f src/ci-lint-policy.test.ts
test -f src/architecture.test.ts
pnpm run build
pnpm run lint
pnpm exec vitest run src/ci-lint-policy.test.ts src/architecture.test.ts
node dist/cli.js define adr --check
CI=true pnpm run test:ci
