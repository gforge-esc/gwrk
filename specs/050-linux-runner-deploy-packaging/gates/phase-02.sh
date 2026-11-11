#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
node --check scripts/release/build-linux-release.mjs
bash -n deploy/linux-runner/install-release.sh
pnpm exec vitest run tests/linux-runner/release-packaging.test.ts
