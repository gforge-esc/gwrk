#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
test -f src/adapters/architecture/readiness.test.ts
test -f src/engine/discover.test.ts
test -f src/commands/project-discover.readiness.test.ts
test -f src/commands/project.test.ts
test -f src/application/architecture/context.test.ts
test -f src/architecture.test.ts
pnpm run build
pnpm exec vitest run src/commands/project-discover.readiness.test.ts src/adapters/architecture/readiness.test.ts src/engine/discover.test.ts src/commands/project.test.ts src/application/architecture/context.test.ts src/architecture.test.ts
