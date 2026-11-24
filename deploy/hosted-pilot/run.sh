#!/bin/bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL=C
umask 077

fail() {
  printf 'Gateway startup: %s\n' "$1" >&2
  exit 1
}

[[ "$#" == 0 ]] || fail arguments-denied
[[ "$(uname -s 2>/dev/null)" == Linux ]] || fail linux-required
[[ "$(id -u 2>/dev/null)" == 0 ]] || fail root-required
[[ ! -L "${BASH_SOURCE[0]}" ]] || fail bundle-invalid
bundle=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
preflight="$bundle/preflight-tls.sh"
compose="$bundle/compose.yaml"
public_config="$bundle/.env"
[[ -f "$preflight" && ! -L "$preflight" ]] || fail preflight-unavailable
[[ -f "$compose" && ! -L "$compose" ]] || fail compose-unavailable
[[ -f "$public_config" && ! -L "$public_config" ]] || fail public-config-invalid
[[ "$(stat -c '%u' -- "$public_config" 2>/dev/null)" == 0 ]] || fail public-config-invalid
mode=$(stat -c '%a' -- "$public_config" 2>/dev/null)
[[ "$mode" =~ ^[0-7]{3,4}$ ]] || fail public-config-invalid
(( (8#$mode & 8#022) == 0 )) || fail public-config-invalid
[[ "$(stat -c '%s' -- "$public_config" 2>/dev/null)" -le 4096 ]] || fail public-config-invalid

# Compose reads only one public setting. The file is never sourced by a shell.
if ! timeout --kill-after=1s 5s awk '
  NR != 1 { exit 1 }
  /^GWRK_AUTH_GOOGLE_CLIENT_ID=[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/ { next }
  { exit 1 }
  END { if (NR != 1) exit 1 }
' "$public_config" >/dev/null 2>&1; then
  fail public-config-invalid
fi

clean_env=(/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root LANG=C LC_ALL=C)
"${clean_env[@]}" /bin/bash "$preflight"

# The reviewed bundle supplies image pins and listener settings at composition.
exec "${clean_env[@]}" /usr/bin/docker --host unix:///var/run/docker.sock compose \
  --project-name gwrk-hosted-pilot \
  --project-directory "$bundle" \
  --file "$compose" \
  --env-file "$public_config" \
  up --detach
