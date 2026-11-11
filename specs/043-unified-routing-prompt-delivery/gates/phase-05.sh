#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
pnpm build
pnpm exec vitest run src/plugins/builtins/agents/agy/adapter.test.ts src/plugins/builtins/agents/claude/adapter.test.ts src/plugins/builtins/agents/codex/adapter.test.ts src/plugins/workflow-runtime.test.ts src/commands/assess.test.ts src/architecture.test.ts
