#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
pnpm build
pnpm exec vitest run src/domain/durable-dispatch.test.ts src/domain/durable-harvest.test.ts src/ports/operations-port.test.ts src/ports/operations-store-schema.test.ts src/architecture.test.ts
