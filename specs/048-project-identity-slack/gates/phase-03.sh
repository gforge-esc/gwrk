#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
pnpm build
pnpm exec vitest run src/server/slack-actions.test.ts src/server/slack-messages.test.ts src/server/slack-agent.test.ts src/server/slack-home.test.ts src/server/slack.test.ts src/architecture.test.ts
