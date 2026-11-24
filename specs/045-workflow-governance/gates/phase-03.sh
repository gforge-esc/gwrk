#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
test -f src/plugins/policy-lock.test.ts
test -f src/plugins/skill-runtime.test.ts
test -f src/plugins/policy-lock.dispatch.test.ts
test -f src/engine/registry-versioning.test.ts
test -f src/architecture.test.ts
pnpm run build
pnpm exec vitest run src/plugins/policy-lock.test.ts src/plugins/skill-runtime.test.ts src/plugins/policy-lock.dispatch.test.ts src/engine/registry-versioning.test.ts src/architecture.test.ts
