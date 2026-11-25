#!/usr/bin/env bash
set -euo pipefail

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

# Network namespace isolation check (CAP-02)
# Ensure outer container network namespace is not shared with host
HOST_NETNS="${HOST_NETNS_INODE:-}"
OUTER_NETNS="${OUTER_NETNS_INODE:-}"

if [ -z "$OUTER_NETNS" ] && [ -e /proc/self/ns/net ]; then
  OUTER_NETNS="$(stat -L -c %i /proc/self/ns/net 2>/dev/null || readlink /proc/self/ns/net 2>/dev/null | sed -n 's/.*\[\([0-9]*\)\].*/\1/p' || true)"
fi

if [ -n "$HOST_NETNS" ] && [ -n "$OUTER_NETNS" ]; then
  if [ "$HOST_NETNS" = "$OUTER_NETNS" ]; then
    echo "outer network namespace is shared with the host (netns inode $OUTER_NETNS)" >&2
    exit 1
  fi
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
  if [ -f "$PROC_UPTIME_PATH" ]; then
    local uptime_sec
    uptime_sec="$(awk '{print $1}' "$PROC_UPTIME_PATH")"
    awk -v u="$uptime_sec" 'BEGIN { printf "%.0f\n", u * 1000 }'
  else
    if command -v python3 >/dev/null 2>&1; then
      python3 -c 'import time; print(int(time.monotonic() * 1000))'
    else
      date +%s%3N 2>/dev/null || date +%s
    fi
  fi
}

write_json_atomic() {
  local target_path="$1"
  local content="$2"
  local temp_path="${target_path}.next"
  printf '%s\n' "$content" > "$temp_path"
  chmod 600 "$temp_path" 2>/dev/null || true
  mv -f "$temp_path" "$target_path"
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
STATE="IDLE"

cleanup() {
  local exit_code=$?
  trap - EXIT TERM INT
  if [ "$RULE_INSTALLED" -eq 1 ] && [ "$RULE_REMOVED_VERIFIED" -ne 1 ]; then
    "$IPTABLES_CMD" -D INPUT "${RULE_ARGS[@]}" 2>/dev/null || true
    if ! "$IPTABLES_CMD" -C INPUT "${RULE_ARGS[@]}" 2>/dev/null; then
      RULE_REMOVED_VERIFIED=1
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
    if [ -f "$ARM_FILE" ]; then
      # Validate arm.json
      REQ_VERSION="$(grep -o '"version"[[:space:]]*:[[:space:]]*[0-9]*' "$ARM_FILE" 2>/dev/null | head -n 1 | sed 's/.*:[[:space:]]*//' || true)"
      REQ_RUN_ID="$(grep -o '"runId"[[:space:]]*:[[:space:]]*"[^"]*"' "$ARM_FILE" 2>/dev/null | head -n 1 | sed 's/.*"runId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' || true)"
      REQ_OP_ID="$(grep -o '"opId"[[:space:]]*:[[:space:]]*[0-9]*' "$ARM_FILE" 2>/dev/null | head -n 1 | sed 's/.*:[[:space:]]*//' || true)"
      REQ_TTL_MS="$(grep -o '"ttlMs"[[:space:]]*:[[:space:]]*[0-9]*' "$ARM_FILE" 2>/dev/null | head -n 1 | sed 's/.*:[[:space:]]*//' || true)"

      if [ "$REQ_VERSION" != "1" ] || [ "$REQ_RUN_ID" != "$RUN_ID" ] || [ "$REQ_OP_ID" != "1" ]; then
        echo "invalid arm request version, runId, or opId" >&2
        exit 1
      fi

      if [ -z "$REQ_TTL_MS" ] || [ "$REQ_TTL_MS" -le 0 ] || [ "$REQ_TTL_MS" -gt 1000 ]; then
        echo "invalid ttlMs in arm request (must be 1..1000)" >&2
        exit 1
      fi

      # Install rule without -w (busy lock must fail closed immediately)
      INSTALL_T0="$(get_monotonic_ms)"
      if ! "$IPTABLES_CMD" -I INPUT 1 "${RULE_ARGS[@]}" 2>/dev/null; then
        echo "iptables installation failed (busy lock or rule error)" >&2
        exit 1
      fi
      INSTALL_T1="$(get_monotonic_ms)"
      INSTALL_DURATION_MS=$((INSTALL_T1 - INSTALL_T0))
      ARMED_START_MS="$INSTALL_T1"
      DEADLINE_MS=$((ARMED_START_MS + REQ_TTL_MS))
      RULE_INSTALLED=1
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

    if [ -f "$RELEASE_FILE" ]; then
      SHOULD_REMOVE=1
      FINAL_STATE="RELEASED"
    elif [ "$CURRENT_MONO_MS" -ge "$DEADLINE_MS" ]; then
      # Independent expiry path deletes rule even if client stalls
      SHOULD_REMOVE=1
      FINAL_STATE="TIMED_OUT"
    fi

    if [ "$SHOULD_REMOVE" -eq 1 ]; then
      REMOVE_T0="$(get_monotonic_ms)"
      if ! "$IPTABLES_CMD" -D INPUT "${RULE_ARGS[@]}" 2>/dev/null; then
        echo "iptables removal failed" >&2
        exit 1
      fi
      REMOVE_T1="$(get_monotonic_ms)"
      REMOVE_DURATION_MS=$((REMOVE_T1 - REMOVE_T0))
      ARMED_DURATION_MS=$((REMOVE_T1 - ARMED_START_MS))

      # Absence check with -C
      if "$IPTABLES_CMD" -C INPUT "${RULE_ARGS[@]}" 2>/dev/null; then
        echo "iptables rule still present after removal" >&2
        exit 1
      fi

      if [ "$REMOVE_DURATION_MS" -gt 1000 ]; then
        echo "rule removal exceeded 1000 ms: ${REMOVE_DURATION_MS} ms" >&2
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

  sleep 0.02 2>/dev/null || sleep 1
done

exit 0
