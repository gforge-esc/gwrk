#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
if [[ "$(uname -s)" == Linux ]]; then
  pnpm build
  pnpm exec vitest run tests/linux-runner/single-instance-recovery.test.ts src/architecture.test.ts
  exit
fi

snapshot=$(mktemp -d)
trap 'rm -rf -- "$snapshot"' EXIT
git ls-files --cached -z -- package.json pnpm-lock.yaml tsconfig.json vitest.config.ts src tests/helpers tests/linux-runner |
  tar --null -T - -cf - | tar -xf - -C "$snapshot"

docker run --rm --mount "type=bind,source=$snapshot,target=/source,readonly" \
  node@sha256:7702d8aa4d5910871692af4480eb3ba86f23047a6417a44d857d06c95d060d3f bash -euc '
    npm install -g pnpm@9.15.9 --no-fund --no-audit
    mkdir /work
    cp -R /source/. /work/
    cd /work
    pnpm install --frozen-lockfile --ignore-scripts
    pnpm rebuild better-sqlite3
    pnpm build
    pnpm exec vitest run tests/linux-runner/single-instance-recovery.test.ts src/architecture.test.ts
  '
