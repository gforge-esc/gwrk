#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
pnpm build
pnpm exec vitest run src/server/model-selector.test.ts src/server/quota-prober.test.ts src/server/task-classifier.test.ts src/server/backend-selector.test.ts src/server/backend-selector.integration.test.ts src/engine/model-routing.test.ts src/commands/ship-routing.integration.test.ts src/server/routing-decisions.test.ts src/architecture.test.ts src/adapters/agents/agent-port.test.ts
