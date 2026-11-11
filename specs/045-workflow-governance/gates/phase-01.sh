#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
test -f src/plugins/workflow-governance.test.ts
test -f src/utils/agent.grounding-decisions.test.ts
test -f src/plugins/builtins/workflows/gwrk-plan/prompt-contract.test.ts
test -f src/commands/define-plan.test.ts
test -f src/architecture.test.ts
pnpm run build
pnpm exec vitest run src/plugins/workflow-governance.test.ts src/utils/agent.grounding-decisions.test.ts src/plugins/builtins/workflows/gwrk-plan/prompt-contract.test.ts src/commands/define-plan.test.ts src/architecture.test.ts
