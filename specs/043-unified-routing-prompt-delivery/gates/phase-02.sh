#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
pnpm build
pnpm exec vitest run src/commands/ship.test.ts src/engine/model-routing.test.ts src/server/agent-registry.test.ts src/server/agent-registry.integration.test.ts src/server/backend-selector.test.ts src/server/backend-selector.integration.test.ts src/engine/ship-orchestrator.review-gate-divergence.test.ts src/architecture.test.ts
