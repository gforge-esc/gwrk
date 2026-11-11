#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/credentials.sh"
load_runner_credentials
cd -- "${GWRK_PILOT_REPO:?Set GWRK_PILOT_REPO.}"
exec node "${GWRK_RELEASE_ROOT:?Set GWRK_RELEASE_ROOT.}/current/dist/cli.js" server start --foreground
