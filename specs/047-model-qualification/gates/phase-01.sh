#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
tests=(
  src/domain/model-qualification.test.ts
  src/adapters/models/smoke-probe.test.ts
  src/architecture.test.ts
  src/ports/model-qualification-port.contract.test.ts
)
for test_file in "${tests[@]}"; do
  if [[ ! -f "$test_file" ]]; then
    echo "Missing required test: $test_file" >&2
    exit 1
  fi
done
pnpm build
pnpm exec vitest run "${tests[@]}"
tsc_flags=(--noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext)
pnpm exec tsc "${tsc_flags[@]}" src/ports/model-qualification-port.contract.test.ts

contract_dir=$(mktemp -d)
trap 'rm -r -- "$contract_dir"' EXIT
ln -s "$PWD/src" "$contract_dir/src"
awk '
  /^```typescript$/ { capture = 1; next }
  /^```$/ && capture { exit }
  capture
' specs/047-model-qualification/contracts/qualification-ports.md > "$contract_dir/published.mts"
cat > "$contract_dir/compatibility.mts" <<'EOF'
import type * as Actual from "./src/ports/model-qualification-port.js";
import type * as Published from "./published.mjs";

type PublishedPorts = {
  catalog: Published.ModelCatalogPort;
  smoke: Published.SmokeProbePort;
  runner: Published.QualificationRunnerPort;
  judge: Published.PromotionJudgePort;
  store: Published.RouteLockStorePort;
};
type ActualPorts = {
  catalog: Actual.ModelCatalogPort;
  smoke: Actual.SmokeProbePort;
  runner: Actual.QualificationRunnerPort;
  judge: Actual.PromotionJudgePort;
  store: Actual.RouteLockStorePort;
};

declare const adapters: PublishedPorts;
declare const ports: ActualPorts;
const actual: ActualPorts = adapters;
const published: PublishedPorts = ports;
EOF
pnpm exec tsc "${tsc_flags[@]}" "$contract_dir/compatibility.mts"
