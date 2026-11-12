#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
pnpm build
pnpm exec vitest run \
  src/utils/agent.test.ts \
  src/plugins/workflow-runtime.test.ts \
  src/commands/ship-routing.integration.test.ts \
  src/utils/agent.grounding-decisions.test.ts \
  src/plugins/skill-runtime.test.ts \
  src/engine/ship-orchestrator.review.test.ts \
  src/engine/ship-orchestrator.test.ts \
  src/engine/ship-orchestrator.review-finding-liveness.test.ts \
  src/commands/plan.test.ts \
  src/commands/specify.test.ts \
  src/commands/define-ontology.issue201.test.ts \
  src/review-dispatch.test.ts \
  src/plugins/builtins/workflows/gwrk-plan/prompt-contract.test.ts \
  src/architecture.test.ts
