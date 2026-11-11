#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
pnpm build
pnpm exec vitest run src/domain/agent-routing.test.ts src/adapters/agents/agent-port.test.ts src/utils/resolve-agent.test.ts src/utils/resolve-model.test.ts src/utils/config-resolution.conformance.test.ts src/engine/router.test.ts src/plugins/skill-runtime.test.ts src/architecture.test.ts
