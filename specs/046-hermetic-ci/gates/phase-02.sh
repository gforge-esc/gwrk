#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

set -euo pipefail
test -f src/cli.pulse.e2e.test.ts
test -f src/engine/pulse-integration.test.ts
test -f src/adapters/cli/output-scope.test.ts
test -f src/architecture.test.ts
pnpm run build
git_fixture=$(mktemp -d)
trap 'rm -rf -- "$git_fixture"' EXIT
for git_var in "${!GIT_@}"; do
  unset "$git_var"
done
export GIT_EDITOR=true EDITOR=true GIT_TERMINAL_PROMPT=0
export GIT_CONFIG_NOSYSTEM=1 GIT_ATTR_NOSYSTEM=1
export GIT_CONFIG_GLOBAL="$git_fixture/gitconfig"
unset GWRK_SKIP_INTEGRATION

git config --file "$git_fixture/gitconfig" init.defaultBranch fixture-default
pulse_suites=(src/cli.pulse.e2e.test.ts src/engine/pulse-integration.test.ts)
pnpm exec vitest run --retry 0 "${pulse_suites[@]}" src/adapters/cli/output-scope.test.ts src/architecture.test.ts

decoy="$git_fixture/decoy"
git init --quiet --initial-branch=main --template= "$decoy"
printf 'export const decoy = 1;\n' > "$decoy/decoy.ts"
git -C "$decoy" add -- decoy.ts
GIT_AUTHOR_DATE=2026-01-06T10:00:00Z GIT_COMMITTER_DATE=2026-01-06T10:00:00Z \
  git -C "$decoy" -c user.name='Pulse Gate' -c user.email=pulse-gate@example.test \
  -c commit.gpgSign=false commit --quiet --no-edit -m 'Add decoy history'

printf '*.ts -diff\n' > "$git_fixture/attributes"
git config --file "$git_fixture/attributes.gitconfig" core.attributesFile "$git_fixture/attributes"

probe_status=0
printf '\nPulse regression probe with a decoy Git directory\n'
GIT_DIR="$decoy/.git" pnpm exec vitest run --retry 0 "${pulse_suites[@]}" || probe_status=$?
printf '\nPulse regression probe with conflicting global Git attributes\n'
env -u GIT_DIR GIT_CONFIG_GLOBAL="$git_fixture/attributes.gitconfig" \
  pnpm exec vitest run --retry 0 "${pulse_suites[@]}" || probe_status=$?
printf '\nPulse regression probe with a Bash startup file\n'
printf 'export GIT_DIR=%q\n' "$decoy/.git" > "$git_fixture/bash-env"
BASH_ENV="$git_fixture/bash-env" pnpm exec vitest run --retry 0 "${pulse_suites[@]}" || probe_status=$?
printf '\nPulse regression probe with an exported Bash function\n'
env 'BASH_FUNC_wc%%=() { command wc -w; }' \
  node ./node_modules/vitest/vitest.mjs run --retry 0 "${pulse_suites[@]}" || probe_status=$?
printf '\nPulse regression probe with inherited shell options\n'
env SHELLOPTS=noexec \
  node ./node_modules/vitest/vitest.mjs run --retry 0 "${pulse_suites[@]}" || probe_status=$?
printf '\nPulse regression probe with inherited tar options\n'
env TAR_READER_OPTIONS=tar:hdrcharset=UTF-16 TAR_OPTIONS=--gwrk-fixture-invalid-option \
  node ./node_modules/vitest/vitest.mjs run --retry 0 "${pulse_suites[@]}" || probe_status=$?
exit "$probe_status"
