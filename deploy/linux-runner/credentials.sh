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

is_canonical_posix_path() {
  local p="$1"
  [[ "$p" == /* && "$p" != / && "$p" != */ ]] || return 1
  [[ "$p" != *"//"* && "$p" != *"\\"* ]] || return 1
  [[ "$p" != *"/./"* && "$p" != *"/../"* && "$p" != *"/." && "$p" != *"/.." ]] || return 1
  local LC_ALL=C
  [[ "$p" != *[[:cntrl:]]* ]] || return 1
  return 0
}

resolve_runner_dist_dir() {
  local script_real script_dir candidate
  script_real=$(realpath -- "${BASH_SOURCE[0]}" 2>/dev/null) || return 1
  script_dir=$(dirname -- "$script_real")
  candidate=$(realpath -- "$script_dir/../../dist" 2>/dev/null) || return 1
  [[ -d "$candidate" ]] || return 1
  printf '%s' "$candidate"
}

validate_origin_auth_file() {
  local setting_name="$1" path secrets_dir_input basename secrets_dir file_real file_dir
  path="${!setting_name:-}"
  [[ -n "$path" ]] || fail "Set $setting_name."
  secrets_dir_input="${GWRK_SECRETS_DIR:-}"
  [[ -n "$secrets_dir_input" ]] || fail "Set GWRK_SECRETS_DIR."
  is_canonical_posix_path "$secrets_dir_input" ||
    fail "Secrets directory path must be canonical: GWRK_SECRETS_DIR"
  is_canonical_posix_path "$path" ||
    fail "Auth file path must be canonical: $setting_name"
  basename=$(basename -- "$path")
  [[ -d "$secrets_dir_input" && ! -L "$secrets_dir_input" ]] ||
    fail "Missing or invalid secrets directory: GWRK_SECRETS_DIR"
  secrets_dir=$(realpath -- "$secrets_dir_input" 2>/dev/null) ||
    fail "Unresolvable secrets directory: GWRK_SECRETS_DIR"
  [[ "$secrets_dir_input" == "$secrets_dir" ]] ||
    fail "Secrets directory must not traverse symlinks: GWRK_SECRETS_DIR"
  [[ -f "$path" && ! -L "$path" && -r "$path" ]] ||
    fail "Missing or unreadable auth file: $basename"
  file_real=$(realpath -- "$path" 2>/dev/null) ||
    fail "Unresolvable auth file: $basename"
  [[ "$path" == "$file_real" ]] ||
    fail "Auth file must not traverse symlinks: $basename"
  file_dir=$(dirname -- "$file_real")
  [[ "$file_dir" == "$secrets_dir" || "$file_dir" == "$secrets_dir"/* ]] ||
    fail "Auth file $basename must be inside secrets directory."
  [[ "$(stat -c '%a:%u:%g' -- "$path")" == "640:0:$(id -g)" ]] ||
    fail "Auth file must have mode 0640 and owner root:$(id -gn): $basename"
}

_validate_origin_auth_contents() {
  local mode="$1" dist_dir
  command -v node >/dev/null || fail "Install node before validating auth files."
  dist_dir=$(resolve_runner_dist_dir) || fail "Missing compiled auth policy modules."
  [[ -f "$dist_dir/domain/auth-policy.js" && -f "$dist_dir/domain/hosted-auth-config.js" ]] ||
    fail "Missing compiled auth policy modules."
  node --input-type=module - "$dist_dir" "$mode" <<'NODE'
import { constants } from "node:fs";
import fs from "node:fs/promises";
import { basename, join, posix } from "node:path";
import { pathToFileURL } from "node:url";

const ALLOWLIST_MAX_BYTES = 65536;
const HMAC_MAX_BYTES = 45;

const [, , distDir, mode] = process.argv;
const env = process.env;

function hasForbiddenControl(text, allowLineWhitespace = false) {
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (
      code === 127 ||
      (code < 32 && !(allowLineWhitespace && code >= 9 && code <= 13))
    ) {
      return true;
    }
  }
  return false;
}

function safeDirectory(stat) {
  return stat.isDirectory() && !stat.isSymbolicLink();
}

function sameDirectory(a, b) {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.uid === b.uid &&
    a.gid === b.gid &&
    a.mode === b.mode
  );
}

async function inspectAncestors(file) {
  const paths = ["/"];
  let current = "";
  for (const part of posix.dirname(file).split("/").filter(Boolean)) {
    current += `/${part}`;
    paths.push(current);
  }
  const snapshots = [];
  for (const dirPath of paths) {
    const stat = await fs.lstat(dirPath, { bigint: true });
    if (!safeDirectory(stat)) throw new Error();
    snapshots.push({ path: dirPath, stat });
  }
  return snapshots;
}

function safeFile(stat, cap) {
  return (
    stat.isFile() &&
    !stat.isSymbolicLink() &&
    (stat.mode & 0o7777n) === 0o640n &&
    stat.size > 0n &&
    stat.size <= BigInt(cap)
  );
}

function sameFile(a, b) {
  return (
    sameDirectory(a, b) &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs &&
    a.nlink === b.nlink
  );
}

async function readProtectedBytes(file, cap) {
  let handle;
  try {
    if (
      constants.O_NOFOLLOW === undefined ||
      constants.O_NONBLOCK === undefined
    ) {
      throw new Error();
    }
    const ancestors = await inspectAncestors(file);
    handle = await fs.open(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const before = await handle.stat({ bigint: true });
    if (!safeFile(before, cap)) throw new Error();
    const buffer = Buffer.alloc(cap + 1);
    let length = 0;
    while (length < buffer.length) {
      const remaining = buffer.length - length;
      const { bytesRead } = await handle.read(buffer, length, remaining, null);
      if (
        !Number.isInteger(bytesRead) ||
        bytesRead < 0 ||
        bytesRead > remaining
      ) {
        throw new Error();
      }
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const current = await fs.lstat(file, { bigint: true });
    if (
      length > cap ||
      BigInt(length) !== before.size ||
      !safeFile(after, cap) ||
      !safeFile(current, cap) ||
      !sameFile(before, after) ||
      !sameFile(after, current)
    ) {
      throw new Error();
    }
    const finalAncestors = await inspectAncestors(file);
    for (let i = 0; i < ancestors.length; i += 1) {
      if (
        ancestors[i].path !== finalAncestors[i].path ||
        !sameDirectory(ancestors[i].stat, finalAncestors[i].stat)
      ) {
        throw new Error();
      }
    }
    return buffer.subarray(0, length);
  } finally {
    if (handle) {
      await handle.close();
    }
  }
}

try {
  if (mode !== "allowlist" && mode !== "csrf" && mode !== "both") {
    throw new Error();
  }
  const { validateAccountAllowlist } = await import(
    pathToFileURL(join(distDir, "domain/auth-policy.js")).href
  );
  const { HostedAuthConfigInputSchema } = await import(
    pathToFileURL(join(distDir, "domain/hosted-auth-config.js")).href
  );
  const pathSchema = HostedAuthConfigInputSchema.shape.googleAllowlistFile;
  const secretsRoot = env.GWRK_SECRETS_DIR;
  if (typeof secretsRoot !== "string" || !pathSchema.safeParse(secretsRoot).success) {
    console.error("Secrets directory path must be canonical: GWRK_SECRETS_DIR");
    process.exitCode = 1;
  } else {
    const checkContainedPath = (file, settingName) => {
      if (typeof file !== "string" || !pathSchema.safeParse(file).success) {
        throw new Error(`Auth file path must be canonical: ${settingName}`);
      }
      const rel = posix.relative(secretsRoot, file);
      if (!rel || rel === ".." || rel.startsWith("../") || posix.isAbsolute(rel)) {
        throw new Error(`Auth file ${basename(file)} must be inside secrets directory.`);
      }
      return file;
    };

    if (mode === "allowlist" || mode === "both") {
      const file = checkContainedPath(
        env.GWRK_AUTH_GOOGLE_ALLOWLIST_FILE,
        "GWRK_AUTH_GOOGLE_ALLOWLIST_FILE",
      );
      try {
        const bytes = await readProtectedBytes(file, ALLOWLIST_MAX_BYTES);
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (hasForbiddenControl(text, true)) throw new Error();
        const lines = text
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        const result = validateAccountAllowlist(lines);
        if (!result.ok) throw new Error();
      } catch {
        throw new Error(`Invalid allowlist file: ${basename(file)}`);
      }
    }

    if (mode === "csrf" || mode === "both") {
      const file = checkContainedPath(
        env.GWRK_AUTH_CSRF_HMAC_FILE,
        "GWRK_AUTH_CSRF_HMAC_FILE",
      );
      try {
        const bytes = await readProtectedBytes(file, HMAC_MAX_BYTES);
        const text = new TextDecoder("utf-8", { fatal: true })
          .decode(bytes)
          .replace(/\r?\n$/, "");
        if (!/^[A-Za-z0-9_-]{43}$/.test(text)) throw new Error();
        const key = Buffer.from(text, "base64url");
        if (key.length !== 32 || key.toString("base64url") !== text) {
          throw new Error();
        }
      } catch {
        throw new Error(`Invalid CSRF HMAC file: ${basename(file)}`);
      }
    }
  }
} catch (error) {
  const message =
    error instanceof Error &&
    (error.message.startsWith("Auth file ") ||
      error.message.startsWith("Invalid allowlist file: ") ||
      error.message.startsWith("Invalid CSRF HMAC file: "))
      ? error.message
      : "Protected authentication file validation failed.";
  console.error(message);
  process.exitCode = 1;
}
NODE
}

validate_origin_allowlist() {
  validate_origin_auth_file GWRK_AUTH_GOOGLE_ALLOWLIST_FILE
  _validate_origin_auth_contents allowlist
}

validate_origin_csrf_hmac() {
  validate_origin_auth_file GWRK_AUTH_CSRF_HMAC_FILE
  _validate_origin_auth_contents csrf
}

validate_origin_auth_files() {
  validate_origin_auth_file GWRK_AUTH_GOOGLE_ALLOWLIST_FILE
  validate_origin_auth_file GWRK_AUTH_CSRF_HMAC_FILE
  _validate_origin_auth_contents both
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
