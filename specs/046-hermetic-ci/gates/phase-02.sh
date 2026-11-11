#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
test -f src/cli.pulse.e2e.test.ts
test -f src/engine/pulse-integration.test.ts
test -f src/adapters/cli/output-scope.test.ts
test -f src/architecture.test.ts
pnpm run build
git_fixture=$(mktemp -d)
trap 'rm -rf -- "$git_fixture"' EXIT
git config --file "$git_fixture/gitconfig" init.defaultBranch fixture-default
env -u GWRK_SKIP_INTEGRATION GIT_CONFIG_GLOBAL="$git_fixture/gitconfig" GIT_CONFIG_NOSYSTEM=1 \
  pnpm exec vitest run --retry 0 src/cli.pulse.e2e.test.ts src/engine/pulse-integration.test.ts src/adapters/cli/output-scope.test.ts src/architecture.test.ts
