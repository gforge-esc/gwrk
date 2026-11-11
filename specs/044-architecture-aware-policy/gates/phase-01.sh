#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
pnpm build
pnpm exec vitest run src/domain/profile-policy.test.ts src/engine/profile-detector.test.ts src/engine/prompt-conditioner.test.ts src/utils/config.test.ts src/architecture.test.ts
pnpm lint --vcs-enabled=true --vcs-client-kind=git --vcs-use-ignore-file=true
