#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
tests=(
  src/plugins/skill-runtime.test.ts
  src/plugins/skill-runtime.p15.red.test.ts
  src/plugins/enforcement.test.ts
  src/plugins/framework-pack-compatibility.test.ts
  src/plugins/builtins/skills/gwrk-conventions/SKILL.test.ts
  src/commands/plugin.p15.red.test.ts
  src/architecture.test.ts
)
for test_file in "${tests[@]}"; do
  if [[ ! -f "$test_file" ]]; then
    printf 'Missing required test: %s\n' "$test_file" >&2
    exit 1
  fi
done
pnpm build
pnpm exec vitest run "${tests[@]}"
