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

validate_origin_auth_file() {
  local setting_name="$1" path
  path="${!setting_name:-}"
  [[ -n "$path" ]] || fail "Set $setting_name."
  local basename
  basename=$(basename -- "$path")
  [[ -f "$path" && ! -L "$path" && -r "$path" ]] || fail "Missing or unreadable auth file: $basename"
  [[ "$(stat -c '%a:%u:%g' -- "$path")" == "640:0:$(id -g)" ]] ||
    fail "Auth file must have mode 0640 and owner root:$(id -gn): $basename"
  local secrets_dir file_real file_dir
  secrets_dir=$(realpath "${GWRK_SECRETS_DIR:?Set GWRK_SECRETS_DIR.}")
  file_real=$(realpath "$path")
  file_dir=$(dirname -- "$file_real")
  [[ "$file_dir" == "$secrets_dir" || "$file_dir" == "$secrets_dir"/* ]] ||
    fail "Auth file $basename must be inside secrets directory."
}

validate_origin_allowlist() {
  validate_origin_auth_file GWRK_AUTH_GOOGLE_ALLOWLIST_FILE
  local path="${GWRK_AUTH_GOOGLE_ALLOWLIST_FILE}"
  local basename
  basename=$(basename -- "$path")
  local valid_count=0 line
  local email_regex='^[-a-zA-Z0-9_.+]+@[-a-zA-Z0-9.]+\.[a-zA-Z0-9.]+$'
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" ]] && continue
    if [[ "$line" == *"*"* ]]; then
      fail "Allowlist cannot contain wildcards: $basename"
    fi
    if [[ ! "$line" =~ $email_regex ]]; then
      fail "Invalid email in allowlist: $basename"
    fi
    valid_count=$((valid_count + 1))
  done < "$path"
  [[ "$valid_count" -gt 0 ]] || fail "Allowlist must contain at least one valid account: $basename"
}

validate_origin_csrf_hmac() {
  validate_origin_auth_file GWRK_AUTH_CSRF_HMAC_FILE
  local path="${GWRK_AUTH_CSRF_HMAC_FILE}"
  local basename
  basename=$(basename -- "$path")
  local csrf_value
  csrf_value=$(< "$path")
  if [[ ! "$csrf_value" =~ ^[a-zA-Z0-9_-]{43}$ ]]; then
    fail "Invalid CSRF HMAC file: $basename"
  fi
  unset csrf_value
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
