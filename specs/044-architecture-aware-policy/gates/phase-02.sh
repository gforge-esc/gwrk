#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
pnpm build
pnpm exec vitest run \
  src/plugins/manifest.test.ts \
  src/domain/policy-selection.test.ts \
  src/application/architecture/context.test.ts \
  src/architecture.test.ts
