#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
tests=(src/application/models/evaluate-models.test.ts src/adapters/models/fixture-runner.test.ts src/domain/model-qualification.test.ts src/ports/model-qualification-port.contract.test.ts src/architecture.test.ts)
for test_file in "${tests[@]}"; do
  if [[ ! -f "$test_file" ]]; then
    echo "Missing required test: $test_file" >&2
    exit 1
  fi
done
bash specs/047-model-qualification/gates/phase-01.sh
pnpm exec vitest run "${tests[@]}"
pnpm exec biome check --vcs-enabled=true --vcs-client-kind=git --vcs-use-ignore-file=true
