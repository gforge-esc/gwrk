#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

# Owned entry point for native verification staging. It holds the run lease,
# runs mandatory retention and disk preflight under the retention lock, then
# executes the staging command with the lease still held.

set -euo pipefail
umask 077
fail() { printf '%s\n' "$*" >&2; exit 1; }

[[ $# -ge 6 && "$5" == -- ]] ||
  fail "Usage: stage-preflight.sh LIFECYCLE_JS RUN_ID BUILD_BYTES DATA_BYTES -- STAGING_COMMAND..."
lifecycle=$(realpath -e -- "$1")
run_id="$2" build_bytes="$3" data_bytes="$4"
shift 5
[[ "$run_id" =~ ^[a-f0-9]{24}$ ]] || fail "Invalid run ID."
[[ "$build_bytes" =~ ^[0-9]+$ && "$data_bytes" =~ ^[0-9]+$ ]] || fail "Byte counts must be integers."
runs="${GWRK_VERIFICATION_RUNS_ROOT:-/opt/gwrk-verification}"
data="${GWRK_VERIFICATION_DATA_ROOT:-/var/lib/gwrk/verification-fixtures}"
protected="${GWRK_PROTECTED_IMAGES_FILE:-$runs/protected-images.json}"
[[ -d "$runs" && ! -L "$runs" && -d "$data" && ! -L "$data" ]] ||
  fail "Verification roots must be real directories."
[[ -f "$protected" && ! -L "$protected" ]] || fail "Protected image list is missing: $protected"

run="$runs/$run_id"
mkdir -p -- "$run"
[[ ! -L "$run" ]] || fail "Run directory must not be a symlink."
exec 7>"$run/.lease"
flock -xn 7 || fail "Another job holds the lease for $run_id."
exec 8>"$runs/.retention.lock"
flock -x 8
node "$lifecycle" verification-preflight --runs-root "$runs" --data-root "$data" \
  --run-id "$run_id" --protected-images "$protected" \
  --build-bytes "$build_bytes" --data-bytes "$data_bytes" ||
  fail "Retention or disk preflight failed. Staging did not start."
exec 8>&-
exec "$@"
