#!/usr/bin/env bash
set -efuo pipefail
umask 077

RUN_ID="${RUN_ID:-${1:-}}"
SYN_GATE_DIR="${SYN_GATE_DIR:-/fixture/syn-gate}"
IPTABLES_CMD="${IPTABLES_CMD:-iptables}"
PROC_UPTIME_PATH="${PROC_UPTIME_PATH:-/proc/uptime}"
MAX_WALL_CLOCK_SECONDS=360

if [ -z "$RUN_ID" ]; then
  echo "RUN_ID is required" >&2
  exit 1
fi

if ! [[ "$RUN_ID" =~ ^[a-f0-9]{24}$ ]]; then
  echo "RUN_ID must be a 24-character lowercase hex string" >&2
  exit 1
fi

# Verify container label / runId binding at startup (required)
CONTAINER_LABEL="${CONTAINER_LABEL:-${GWRK_CONTAINER_LABEL:-${FIXTURE_LABEL:-${GWRK_FIXTURE_RUN:-}}}}"
EXPECTED_LABEL="gwrk.fixture.run=${RUN_ID}"
if [ -z "$CONTAINER_LABEL" ] || [ "$CONTAINER_LABEL" != "$EXPECTED_LABEL" ]; then
  echo "container label mismatch: expected $EXPECTED_LABEL, got '$CONTAINER_LABEL'" >&2
  exit 1
fi

# Network namespace isolation check (CAP-02)
# Ensure outer container network namespace is not shared with host
HOST_NETNS="${HOST_NETNS_INODE:-}"
OUTER_NETNS="${OUTER_NETNS_INODE:-}"

if [ -z "$HOST_NETNS" ]; then
  echo "HOST_NETNS_INODE is required" >&2
  exit 1
fi

if [ -z "$OUTER_NETNS" ]; then
  if [ -e /proc/self/ns/net ]; then
    OUTER_NETNS="$(readlink /proc/self/ns/net 2>/dev/null || stat -L -c %i /proc/self/ns/net 2>/dev/null || true)"
  fi
fi

if [ -z "$OUTER_NETNS" ]; then
  echo "OUTER_NETNS_INODE is required or /proc/self/ns/net must be present" >&2
  exit 1
fi

HOST_INODE="$(echo "$HOST_NETNS" | sed -n 's/.*\[\([0-9]*\)\].*/\1/p')"
if [ -z "$HOST_INODE" ]; then
  HOST_INODE="$HOST_NETNS"
fi
OUTER_INODE="$(echo "$OUTER_NETNS" | sed -n 's/.*\[\([0-9]*\)\].*/\1/p')"
if [ -z "$OUTER_INODE" ]; then
  OUTER_INODE="$OUTER_NETNS"
fi

if ! [[ "$HOST_INODE" =~ ^[0-9]+$ ]] || ! [[ "$OUTER_INODE" =~ ^[0-9]+$ ]]; then
  echo "invalid network namespace inode format: host=$HOST_NETNS, outer=$OUTER_NETNS" >&2
  exit 1
fi

if [ "$HOST_INODE" = "$OUTER_INODE" ]; then
  echo "outer network namespace is shared with the host (netns inode $OUTER_INODE)" >&2
  exit 1
fi

# Verify IPC directory (mode 0700, no symlinks, root-owned if root)
if [ -L "$SYN_GATE_DIR" ]; then
  echo "SYN_GATE_DIR must not be a symlink: $SYN_GATE_DIR" >&2
  exit 1
fi

if [ ! -d "$SYN_GATE_DIR" ]; then
  echo "SYN_GATE_DIR directory missing: $SYN_GATE_DIR" >&2
  exit 1
fi

DIR_MODE="$(stat -c %a "$SYN_GATE_DIR" 2>/dev/null || stat -f %Lp "$SYN_GATE_DIR" 2>/dev/null || true)"
if [ "$DIR_MODE" != "700" ]; then
  echo "SYN_GATE_DIR must have mode 0700, got $DIR_MODE" >&2
  exit 1
fi

if [ "$(id -u)" -eq 0 ]; then
  DIR_UID="$(stat -c %u "$SYN_GATE_DIR" 2>/dev/null || stat -f %u "$SYN_GATE_DIR" 2>/dev/null || true)"
  DIR_GID="$(stat -c %g "$SYN_GATE_DIR" 2>/dev/null || stat -f %g "$SYN_GATE_DIR" 2>/dev/null || true)"
  if [ "$DIR_UID" != "0" ] || [ "$DIR_GID" != "0" ]; then
    echo "SYN_GATE_DIR must be owned by 0:0, got $DIR_UID:$DIR_GID" >&2
    exit 1
  fi
fi

get_monotonic_ms() {
  if [ ! -f "$PROC_UPTIME_PATH" ] || [ ! -r "$PROC_UPTIME_PATH" ]; then
    echo "monotonic clock missing or unreadable: $PROC_UPTIME_PATH" >&2
    exit 1
  fi
  local uptime_sec
  uptime_sec="$(awk '{print $1}' "$PROC_UPTIME_PATH" 2>/dev/null || true)"
  if [ -z "$uptime_sec" ]; then
    echo "unable to read monotonic clock from $PROC_UPTIME_PATH" >&2
    exit 1
  fi
  awk -v u="$uptime_sec" 'BEGIN { printf "%.0f\n", u * 1000 }'
}

write_json_atomic() {
  local target_path="$1"
  local content="$2"
  local temp_path="${target_path}.next"
  if [ -L "$temp_path" ]; then
    echo "temporary file must not be a symlink: $temp_path" >&2
    rm -f "$temp_path" 2>/dev/null || true
    exit 1
  fi
  if [ -L "$target_path" ]; then
    echo "target file must not be a symlink: $target_path" >&2
    exit 1
  fi
  if [ -e "$temp_path" ]; then
    rm -f "$temp_path"
  fi
  printf '%s\n' "$content" > "$temp_path"
  chmod 600 "$temp_path" 2>/dev/null || true
  mv -f "$temp_path" "$target_path"
}

validate_request_file() {
  local file_path="$1"
  if [ -L "$file_path" ]; then
    echo "request file must not be a symlink: $file_path" >&2
    exit 1
  fi
  if [ ! -f "$file_path" ]; then
    return 1
  fi
  local f_mode
  f_mode="$(stat -c %a "$file_path" 2>/dev/null || stat -f %Lp "$file_path" 2>/dev/null || true)"
  if [ "$f_mode" != "600" ]; then
    echo "request file must have mode 0600, got $f_mode" >&2
    exit 1
  fi
  if [ "$(id -u)" -eq 0 ]; then
    local f_uid f_gid
    f_uid="$(stat -c %u "$file_path" 2>/dev/null || stat -f %u "$file_path" 2>/dev/null || true)"
    f_gid="$(stat -c %g "$file_path" 2>/dev/null || stat -f %g "$file_path" 2>/dev/null || true)"
    if [ "$f_uid" != "0" ] || [ "$f_gid" != "0" ]; then
      echo "request file must be owned by 0:0, got $f_uid:$f_gid" >&2
      exit 1
    fi
  fi
  return 0
}

# Exact hardcoded iptables rule arguments (no -w, no custom chains, no flush)
RULE_ARGS=(-i lo -p tcp -s 127.0.0.1 -d 127.0.0.1 --dport 18790 --tcp-flags SYN,RST,ACK,FIN SYN -j DROP)

RULE_INSTALLED=0
RULE_REMOVED_VERIFIED=0
INSTALL_DURATION_MS=0
REMOVE_DURATION_MS=0
ARMED_DURATION_MS=0
ARMED_START_MS=0
DEADLINE_MS=0
CLEANUP_RESERVE_MS=50
REQ_TTL_MS=1000
STATE="IDLE"

cleanup() {
  local exit_code=$?
  trap - EXIT TERM INT
  if [ "$RULE_INSTALLED" -eq 1 ] && [ "$RULE_REMOVED_VERIFIED" -ne 1 ]; then
    if command -v timeout >/dev/null 2>&1; then
      timeout 1 "$IPTABLES_CMD" -D INPUT "${RULE_ARGS[@]}" 2>/dev/null || true
      set +e
      timeout 1 "$IPTABLES_CMD" -C INPUT "${RULE_ARGS[@]}" 2>/dev/null
      local c_status=$?
      set -e
    else
      "$IPTABLES_CMD" -D INPUT "${RULE_ARGS[@]}" 2>/dev/null || true
      set +e
      "$IPTABLES_CMD" -C INPUT "${RULE_ARGS[@]}" 2>/dev/null
      local c_status=$?
      set -e
    fi
    if [ "$c_status" -eq 1 ]; then
      RULE_REMOVED_VERIFIED=1
    else
      RULE_REMOVED_VERIFIED=0
    fi
  fi
  if [ "$RULE_INSTALLED" -eq 1 ] && [ "$RULE_REMOVED_VERIFIED" -ne 1 ]; then
    exit 1
  fi
  exit "$exit_code"
}
trap cleanup EXIT TERM INT

START_WALL_SEC="$(date +%s)"

while true; do
  # Check 360s wall clock cap
  CURRENT_WALL_SEC="$(date +%s)"
  if [ $((CURRENT_WALL_SEC - START_WALL_SEC)) -ge "$MAX_WALL_CLOCK_SECONDS" ]; then
    echo "wall-clock cap of 360s exceeded" >&2
    break
  fi

  # Check stdin non-blocking: EOF or STOP causes clean exit
  if read -r -t 0.05 line; then
    if [ "$line" = "STOP" ]; then
      break
    fi
  else
    read_status=$?
    if [ "$read_status" -ne 0 ] && [ "$read_status" -le 128 ]; then
      # EOF on stdin: controller closed stdin
      break
    fi
  fi

  CURRENT_MONO_MS="$(get_monotonic_ms)"

  if [ "$STATE" = "IDLE" ]; then
    ARM_FILE="${SYN_GATE_DIR}/arm.json"
    if [ -L "$ARM_FILE" ]; then
      echo "arm.json must not be a symlink" >&2
      exit 1
    fi
    if [ -f "$ARM_FILE" ]; then
      validate_request_file "$ARM_FILE"

      # Validate arm.json with strict anchored full-string validator
      REQ_TTL_RAW="$(awk -v expected_run_id="$RUN_ID" '
BEGIN { content = "" }
{ content = content $0 "\n" }
END {
  raw = content
  gsub(/^[[:space:]]+|[[:space:]]+$/, "", raw)
  if (raw !~ /^\{.*\}$/) { exit 1 }
  stripped = raw
  gsub(/[[:space:]]+/, "", stripped)
  if (stripped !~ /^\{.*\}$/) { exit 1 }
  inner = substr(stripped, 2, length(stripped) - 2)
  n = split(inner, pairs, ",")
  if (n != 4) { exit 1 }
  has_version = 0; has_run_id = 0; has_op_id = 0; has_ttl = 0; ttl_val = 0
  for (i = 1; i <= n; i++) {
    pair = pairs[i]
    if (pair == "\"version\":1") has_version++
    else if (pair == ("\"runId\":\"" expected_run_id "\"")) has_run_id++
    else if (pair == "\"opId\":1") has_op_id++
    else if (pair ~ /^"ttlMs":[1-9][0-9]*$/) {
      has_ttl++
      split(pair, p, ":")
      ttl_val = p[2] + 0
      if (ttl_val < 1 || ttl_val > 1000) exit 1
    } else exit 1
  }
  if (has_version != 1 || has_run_id != 1 || has_op_id != 1 || has_ttl != 1) exit 1
  print ttl_val
  exit 0
}
' "$ARM_FILE" 2>/dev/null || true)"

      if [ -z "$REQ_TTL_RAW" ]; then
        echo "invalid arm request format, keys, or values" >&2
        exit 1
      fi
      REQ_TTL_MS=$((10#$REQ_TTL_RAW))

      # Bound iptables -I with timeout against REQ_TTL_MS
      INSTALL_TIMEOUT_MS="$REQ_TTL_MS"
      if [ "$INSTALL_TIMEOUT_MS" -gt 1000 ]; then
        INSTALL_TIMEOUT_MS=1000
      fi
      INSTALL_TIMEOUT_SEC="$(awk -v ms="$INSTALL_TIMEOUT_MS" 'BEGIN { printf "%.3f", ms / 1000 }')"

      INSTALL_T0="$(get_monotonic_ms)"
      if command -v timeout >/dev/null 2>&1; then
        if ! timeout "$INSTALL_TIMEOUT_SEC" "$IPTABLES_CMD" -I INPUT 1 "${RULE_ARGS[@]}" 2>/dev/null; then
          echo "iptables installation failed (busy lock or rule error or timeout)" >&2
          exit 1
        fi
      else
        if ! "$IPTABLES_CMD" -I INPUT 1 "${RULE_ARGS[@]}" 2>/dev/null; then
          echo "iptables installation failed (busy lock or rule error)" >&2
          exit 1
        fi
      fi
      RULE_INSTALLED=1

      INSTALL_T1="$(get_monotonic_ms)"
      INSTALL_DURATION_MS=$((INSTALL_T1 - INSTALL_T0))
      if [ "$INSTALL_DURATION_MS" -ge "$REQ_TTL_MS" ] || [ "$INSTALL_DURATION_MS" -gt 1000 ]; then
        echo "iptables installation duration ($INSTALL_DURATION_MS ms) exceeded ttlMs ($REQ_TTL_MS ms)" >&2
        exit 1
      fi

      ARMED_START_MS="$INSTALL_T1"
      DEADLINE_MS=$((ARMED_START_MS + REQ_TTL_MS))
      # Reserve cleanup time before DEADLINE_MS (up to 100ms or 20% of TTL)
      CLEANUP_RESERVE_MS=$((REQ_TTL_MS / 5))
      if [ "$CLEANUP_RESERVE_MS" -lt 20 ]; then
        CLEANUP_RESERVE_MS=20
      fi
      if [ "$CLEANUP_RESERVE_MS" -gt 100 ]; then
        CLEANUP_RESERVE_MS=100
      fi

      STATE="ARMED"

      STATUS_JSON=$(cat <<EOF
{
  "version": 1,
  "state": "ARMED",
  "ruleInstalled": true,
  "installDurationMs": $INSTALL_DURATION_MS,
  "uptimeMs": $INSTALL_T1
}
EOF
)
      write_json_atomic "${SYN_GATE_DIR}/status.json" "$STATUS_JSON"
    fi

  elif [ "$STATE" = "ARMED" ]; then
    RELEASE_FILE="${SYN_GATE_DIR}/release.json"
    SHOULD_REMOVE=0
    FINAL_STATE="RELEASED"

    if [ -L "$RELEASE_FILE" ]; then
      echo "release.json must not be a symlink" >&2
      exit 1
    fi

    if [ -f "$RELEASE_FILE" ]; then
      validate_request_file "$RELEASE_FILE"

      # Validate release.json with strict anchored full-string validator
      if ! awk -v expected_run_id="$RUN_ID" '
BEGIN { content = "" }
{ content = content $0 "\n" }
END {
  raw = content
  gsub(/^[[:space:]]+|[[:space:]]+$/, "", raw)
  if (raw !~ /^\{.*\}$/) { exit 1 }
  stripped = raw
  gsub(/[[:space:]]+/, "", stripped)
  if (stripped !~ /^\{.*\}$/) { exit 1 }
  inner = substr(stripped, 2, length(stripped) - 2)
  n = split(inner, pairs, ",")
  if (n != 4) { exit 1 }
  has_version = 0; has_run_id = 0; has_op_id = 0; has_action = 0
  for (i = 1; i <= n; i++) {
    pair = pairs[i]
    if (pair == "\"version\":1") has_version++
    else if (pair == ("\"runId\":\"" expected_run_id "\"")) has_run_id++
    else if (pair == "\"opId\":1") has_op_id++
    else if (pair == "\"action\":\"release\"") has_action++
    else exit 1
  }
  if (has_version != 1 || has_run_id != 1 || has_op_id != 1 || has_action != 1) exit 1
  exit 0
}
' "$RELEASE_FILE" 2>/dev/null; then
        echo "invalid release.json keys/values" >&2
        exit 1
      fi
      SHOULD_REMOVE=1
      FINAL_STATE="RELEASED"
    elif [ "$CURRENT_MONO_MS" -ge "$((DEADLINE_MS - CLEANUP_RESERVE_MS))" ]; then
      SHOULD_REMOVE=1
      FINAL_STATE="TIMED_OUT"
    fi

    if [ "$SHOULD_REMOVE" -eq 1 ]; then
      NOW_MS="$(get_monotonic_ms)"
      REMAINING_BUDGET_MS=$((DEADLINE_MS - NOW_MS))
      if [ "$REMAINING_BUDGET_MS" -gt 1000 ]; then
        REMAINING_BUDGET_MS=1000
      fi
      if [ "$REMAINING_BUDGET_MS" -le 0 ]; then
        REMAINING_BUDGET_MS=50
      fi
      TIMEOUT_SEC="$(awk -v ms="$REMAINING_BUDGET_MS" 'BEGIN { printf "%.3f", ms / 1000 }')"

      REMOVE_T0="$(get_monotonic_ms)"
      if command -v timeout >/dev/null 2>&1; then
        if ! timeout "$TIMEOUT_SEC" "$IPTABLES_CMD" -D INPUT "${RULE_ARGS[@]}" 2>/dev/null; then
          echo "iptables removal failed" >&2
          exit 1
        fi
      else
        if ! "$IPTABLES_CMD" -D INPUT "${RULE_ARGS[@]}" 2>/dev/null; then
          echo "iptables removal failed" >&2
          exit 1
        fi
      fi

      REMOVE_T1="$(get_monotonic_ms)"
      REMOVE_DURATION_MS=$((REMOVE_T1 - REMOVE_T0))
      ARMED_DURATION_MS=$((REMOVE_T1 - ARMED_START_MS))

      # Absence check with -C: ONLY exit status 1 confirms rule absence
      set +e
      if command -v timeout >/dev/null 2>&1; then
        timeout 1 "$IPTABLES_CMD" -C INPUT "${RULE_ARGS[@]}" 2>/dev/null
        C_STATUS=$?
      else
        "$IPTABLES_CMD" -C INPUT "${RULE_ARGS[@]}" 2>/dev/null
        C_STATUS=$?
      fi
      set -e

      if [ "$C_STATUS" -ne 1 ]; then
        if [ "$C_STATUS" -eq 0 ]; then
          echo "iptables rule still present after removal" >&2
        else
          echo "iptables absence check failed with status $C_STATUS" >&2
        fi
        RULE_REMOVED_VERIFIED=0
        exit 1
      fi

      if [ "$ARMED_DURATION_MS" -gt 1000 ] || [ "$REMOVE_DURATION_MS" -gt 1000 ]; then
        echo "timing bounds exceeded: armedDurationMs=$ARMED_DURATION_MS, removeDurationMs=$REMOVE_DURATION_MS" >&2
        RECEIPT_JSON=$(cat <<EOF
{
  "version": 1,
  "runId": "$RUN_ID",
  "opId": 1,
  "state": "FAULTED",
  "installDurationMs": $INSTALL_DURATION_MS,
  "armedDurationMs": $ARMED_DURATION_MS,
  "removeDurationMs": $REMOVE_DURATION_MS,
  "ruleRemovedVerified": false
}
EOF
)
        write_json_atomic "${SYN_GATE_DIR}/receipt.json" "$RECEIPT_JSON"
        RULE_REMOVED_VERIFIED=0
        exit 1
      fi

      RULE_REMOVED_VERIFIED=1

      RECEIPT_JSON=$(cat <<EOF
{
  "version": 1,
  "runId": "$RUN_ID",
  "opId": 1,
  "state": "$FINAL_STATE",
  "installDurationMs": $INSTALL_DURATION_MS,
  "armedDurationMs": $ARMED_DURATION_MS,
  "removeDurationMs": $REMOVE_DURATION_MS,
  "ruleRemovedVerified": true
}
EOF
)
      write_json_atomic "${SYN_GATE_DIR}/receipt.json" "$RECEIPT_JSON"
      # Single operation complete, exit cleanly
      break
    fi
  fi

  CURRENT_MONO_MS="$(get_monotonic_ms)"
  if [ "$STATE" = "ARMED" ]; then
    REMAIN_MS=$((DEADLINE_MS - CLEANUP_RESERVE_MS - CURRENT_MONO_MS))
    if [ "$REMAIN_MS" -le 0 ]; then
      continue
    fi
    if [ "$REMAIN_MS" -lt 20 ]; then
      sleep 0.005 2>/dev/null || sleep 0.02 2>/dev/null || sleep 1
      continue
    fi
  fi
  sleep 0.02 2>/dev/null || sleep 1
done

exit 0
