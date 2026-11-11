#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
bash -n deploy/linux-runner/install-release.sh
bash -n deploy/linux-runner/rollback-release.sh
pnpm build
pnpm exec vitest run tests/linux-runner/backup-restore-rollback.test.ts src/domain/release-packaging.test.ts src/architecture.test.ts
