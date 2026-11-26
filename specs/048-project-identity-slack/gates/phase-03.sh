#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
test -f src/commands/adr.checkout.test.ts
pnpm build
pnpm lint
pnpm exec vitest run \
  src/adapters/git/index.test.ts \
  src/utils/agent-context.test.ts \
  src/engine/issues.test.ts \
  src/server/slack-actions.test.ts \
  src/server/slack-agent.test.ts \
  src/server/slack-commands.test.ts \
  src/server/slack-home.test.ts \
  src/server/slack-messages.test.ts \
  src/server/slack-notify.test.ts \
  src/server/slack.test.ts \
  src/commands/adr.checkout.test.ts \
  src/commands/adr.test.ts \
  src/engine/adr-scaffold.test.ts \
  src/engine/adr-check.test.ts \
  src/architecture.test.ts
