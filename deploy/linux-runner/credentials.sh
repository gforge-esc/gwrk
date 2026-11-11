#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

fail() { printf '%s\n' "$*" >&2; exit 1; }

read_credential() {
  local name="$1" path value
  path="${GWRK_SECRETS_DIR:?Set GWRK_SECRETS_DIR.}/$name"
  [[ -f "$path" && ! -L "$path" && -r "$path" ]] || fail "Missing or unreadable credential: $name"
  [[ "$(stat -c '%a:%u:%g' -- "$path")" == "640:0:$(id -g)" ]] ||
    fail "Credential must have mode 0640 and owner root:$(id -gn): $name"
  value=$(< "$path")
  [[ -n "$value" && "$value" != *[[:space:]]* ]] || fail "Credential must be one nonempty value: $name"
  case "${value,,}" in
    *placeholder*|*changeme*|*replace*|*example.invalid*) fail "Replace the sample credential: $name" ;;
  esac
  printf '%s' "$value"
}

load_runner_credentials() {
  [[ -z "${TELEGRAM_BOT_TOKEN+x}${TELEGRAM_CHAT_ID+x}" ]] ||
    fail "Remove Telegram variables from the hosted service."
  local git_token
  git_token=$(read_credential pilot-git-credential) || return 1
  read_credential agent-credential >/dev/null || return 1
  export GH_TOKEN="$git_token"
  export GWRK_AGENT_CREDENTIAL_FILE="$GWRK_SECRETS_DIR/agent-credential"
  export GH_PROMPT_DISABLED=1 GIT_TERMINAL_PROMPT=0
  export GIT_CONFIG_COUNT=2
  export GIT_CONFIG_KEY_0=credential.helper GIT_CONFIG_VALUE_0=
  export GIT_CONFIG_KEY_1=credential.https://github.com.helper
  export GIT_CONFIG_VALUE_1='!gh auth git-credential'

  case "${GWRK_SLACK_ENABLED:-0}" in
    0) unset SLACK_BOT_TOKEN SLACK_APP_TOKEN SLACK_WEBHOOK_URL ;;
    1)
      local bot app
      bot=$(read_credential slack-bot-token) || return 1
      app=$(read_credential slack-app-token) || return 1
      [[ "$bot" == xoxb-* && "$app" == xapp-* ]] || fail "Slack requires bot and app tokens."
      export SLACK_BOT_TOKEN="$bot" SLACK_APP_TOKEN="$app"
      unset SLACK_WEBHOOK_URL
      ;;
    *) fail "Set GWRK_SLACK_ENABLED to 0 or 1." ;;
  esac
}
