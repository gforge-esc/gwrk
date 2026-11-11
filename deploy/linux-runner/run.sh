#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
script_dir=$(dirname -- "$(realpath -e -- "${BASH_SOURCE[0]}")")
cli=$(realpath -e -- "$script_dir/../../dist/cli.js")
source "$script_dir/credentials.sh"
load_runner_credentials
cd -- "${GWRK_PILOT_REPO:?Set GWRK_PILOT_REPO.}"
exec node "$cli" server start --foreground
