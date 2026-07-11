#!/usr/bin/env bash
set -euo pipefail

COMMAND="${1:-status}"
REASON="${2:-}"

: "${WRITE_PAUSE_BASE_URL:?Set WRITE_PAUSE_BASE_URL to the deployed application origin}"
: "${CRON_SECRET:?Set CRON_SECRET from the production password manager}"

for command in curl jq; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required command: $command" >&2
    exit 1
  fi
done

BASE_URL="${WRITE_PAUSE_BASE_URL%/}"
CONTROL_URL="$BASE_URL/api/internal/write-pause"
REPLAY_URL="$BASE_URL/api/internal/stripe-webhooks/replay-deferred"
POLL_SECONDS="${WRITE_PAUSE_POLL_SECONDS:-2}"
TIMEOUT_SECONDS="${WRITE_PAUSE_TIMEOUT_SECONDS:-180}"
DRAIN_TIMEOUT_SECONDS="${WRITE_PAUSE_DRAIN_TIMEOUT_SECONDS:-900}"
REPLAY_BATCH_LIMIT="${WRITE_PAUSE_REPLAY_BATCH_LIMIT:-25}"

status() {
  curl --fail-with-body --silent --show-error \
    --request GET \
    --header "Authorization: Bearer $CRON_SECRET" \
    --header 'Accept: application/json' \
    "$CONTROL_URL"
}

set_state() {
  local target_state="$1"
  local reason="$2"
  local current revision payload

  current="$(status)" || return 1
  revision="$(jq -er '.revision' <<<"$current")" || return 1
  payload="$(jq -cn \
    --arg state "$target_state" \
    --argjson expected_revision "$revision" \
    --arg reason "$reason" \
    '{state: $state, expected_revision: $expected_revision, reason: $reason}')" || return 1

  curl --fail-with-body --silent --show-error \
    --request POST \
    --header "Authorization: Bearer $CRON_SECRET" \
    --header 'Content-Type: application/json' \
    --data "$payload" \
    "$CONTROL_URL"
}

wait_until_safe() {
  local started now current
  started="$(date +%s)"

  while true; do
    current="$(status)" || return 1
    if [[ "$(jq -r '.state' <<<"$current")" != 'paused' ]]; then
      echo 'Write pause left paused state while waiting for the request drain interval.' >&2
      exit 1
    fi
    if [[ "$(jq -r '.safe_to_migrate' <<<"$current")" == 'true' ]]; then
      jq . <<<"$current"
      return
    fi

    now="$(date +%s)"
    if (( now - started >= TIMEOUT_SECONDS )); then
      echo "Timed out waiting for write pause to become safe_to_migrate after ${TIMEOUT_SECONDS}s." >&2
      jq . <<<"$current" >&2
      exit 1
    fi
    sleep "$POLL_SECONDS"
  done
}

drain_deferred_webhooks() {
  local reason="$1"
  local result remaining finalized started now
  started="$(date +%s)"

  while true; do
    now="$(date +%s)"
    if (( now - started >= DRAIN_TIMEOUT_SECONDS )); then
      echo "Deferred Stripe webhook drain timed out after ${DRAIN_TIMEOUT_SECONDS}s." >&2
      return 1
    fi

    result="$(curl --fail-with-body --silent --show-error \
      --request POST \
      --header "Authorization: Bearer $CRON_SECRET" \
      --header 'Content-Type: application/json' \
      --data "{\"limit\":$REPLAY_BATCH_LIMIT}" \
      "$REPLAY_URL")" || return 1
    jq . <<<"$result"
    remaining="$(jq -er '.remaining' <<<"$result")" || return 1
    if [[ "$remaining" == '0' ]]; then
      finalized="$(set_state open "$reason")" || return 1
      jq . <<<"$finalized"
      if [[ "$(jq -r '.state' <<<"$finalized")" == 'open' ]] \
        && [[ "$(jq -r '.opened' <<<"$finalized")" == 'true' ]]; then
        return 0
      fi

      # A delivery may have queued after the batch count and before the final
      # RPC acquired its row lock. The RPC keeps the state draining and reports
      # queue_not_empty, so continue until a serialized zero is observed.
      if [[ "$(jq -r '.transition_code' <<<"$finalized")" != 'queue_not_empty' ]]; then
        echo 'Atomic write-pause finalization failed.' >&2
        return 1
      fi
    fi

    sleep "$POLL_SECONDS"
  done
}

repause_after_failure() {
  local failure_reason="$1"
  local current current_state repause_reason

  current="$(status)" || {
    echo 'Could not read write-pause state after drain failure; release must stop.' >&2
    return 1
  }
  current_state="$(jq -er '.state' <<<"$current")" || return 1
  if [[ "$current_state" == 'paused' ]]; then
    return 0
  fi

  repause_reason="Automatic re-pause after webhook drain failure: $failure_reason"
  set_state paused "$repause_reason" | jq . || {
    echo 'Automatic re-pause failed; release must stop and operators must intervene.' >&2
    return 1
  }
}

case "$COMMAND" in
  status)
    status | jq .
    ;;
  enable)
    if [[ -z "$REASON" ]]; then
      REASON='Coordinated database migration window'
    fi
    set_state paused "$REASON" | jq .
    wait_until_safe
    ;;
  disable)
    if [[ -z "$REASON" ]]; then
      REASON='Coordinated database migration window complete'
    fi
    current="$(status)"
    current_state="$(jq -er '.state' <<<"$current")"
    if [[ "$current_state" == 'open' ]]; then
      jq . <<<"$current"
      exit 0
    fi
    if [[ "$current_state" == 'paused' ]]; then
      set_state draining "$REASON" | jq .
    elif [[ "$current_state" != 'draining' ]]; then
      echo "Cannot disable write pause from state: $current_state" >&2
      exit 1
    fi

    if ! drain_deferred_webhooks "$REASON"; then
      repause_after_failure "$REASON" || true
      exit 1
    fi
    status | jq .
    ;;
  *)
    echo 'Usage: toggle-write-pause.sh status|enable|disable [reason]' >&2
    exit 64
    ;;
esac
