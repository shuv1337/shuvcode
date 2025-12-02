#!/bin/sh
# RSS-based release watcher for upstream opencode releases
# Polls the Atom feed and triggers a GitHub workflow when a new release is detected
#
# Features:
# - Uses persistent state file to prevent duplicate triggers
# - Writes state BEFORE triggering to prevent retries on crash
# - Uses lock file to prevent multiple instances
# - Fetches last-synced-tag from repo as fallback state

set -eu

FEED_URL="https://github.com/sst/opencode/releases.atom"
STATE_DIR="${STATE_DIR:-${HOME}/.cache/release-watcher}"
STATE_FILE="${STATE_DIR}/last-release-tag"
LOCK_FILE="${STATE_DIR}/watcher.lock"
CHECK_INTERVAL="${CHECK_INTERVAL:-60}"
GITHUB_REPO="${GITHUB_REPO:-Latitudes-Dev/shuvcode}"

log() {
  echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] $*"
}

cleanup() {
  rm -f "$LOCK_FILE" 2>/dev/null || true
  log "Cleanup complete"
}

acquire_lock() {
  mkdir -p "$STATE_DIR"
  if [ -f "$LOCK_FILE" ]; then
    OLD_PID=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
      log "ERROR: Another instance is already running (PID: $OLD_PID)"
      exit 1
    fi
    log "Stale lock file found, removing"
    rm -f "$LOCK_FILE"
  fi
  echo $$ > "$LOCK_FILE"
  trap cleanup EXIT INT TERM
}

get_latest_tag() {
  curl -fsSL "$FEED_URL" 2>/dev/null | sed -n 's/.*<title>\(v[^<]*\)<\/title>.*/\1/p' | head -1
}

get_repo_synced_tag() {
  # Fetch last-synced-tag from the repo as authoritative state
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    curl -fsSL \
      -H "Accept: application/vnd.github.raw" \
      -H "Authorization: Bearer $GITHUB_TOKEN" \
      "https://api.github.com/repos/$GITHUB_REPO/contents/.github/last-synced-tag?ref=integration" 2>/dev/null | tr -d '\n' || true
  fi
}

trigger_workflow() {
  local tag="$1"
  log "Triggering upstream-sync workflow for $tag"
  
  if [ -z "${GITHUB_TOKEN:-}" ]; then
    log "ERROR: GITHUB_TOKEN not set, cannot trigger workflow"
    return 1
  fi
  
  HTTP_CODE=$(curl -sS -o /dev/null -w "%{http_code}" -X POST \
    -H "Accept: application/vnd.github+json" \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    "https://api.github.com/repos/$GITHUB_REPO/dispatches" \
    -d "{\"event_type\":\"upstream-release\",\"client_payload\":{\"tag\":\"$tag\"}}")
  
  if [ "$HTTP_CODE" = "204" ] || [ "$HTTP_CODE" = "200" ]; then
    log "Workflow triggered successfully (HTTP $HTTP_CODE)"
    return 0
  else
    log "ERROR: Failed to trigger workflow (HTTP $HTTP_CODE)"
    return 1
  fi
}

main() {
  acquire_lock
  
  log "Starting release watcher"
  log "Feed: $FEED_URL"
  log "State file: $STATE_FILE"
  log "Check interval: ${CHECK_INTERVAL}s"
  log "Target repo: $GITHUB_REPO"
  
  mkdir -p "$STATE_DIR"
  
  # Initialize state from repo's last-synced-tag if local state doesn't exist
  if [ ! -f "$STATE_FILE" ]; then
    log "Local state not found, checking repo state..."
    REPO_TAG=$(get_repo_synced_tag)
    if [ -n "$REPO_TAG" ]; then
      echo "$REPO_TAG" > "$STATE_FILE"
      log "Initialized from repo last-synced-tag: $REPO_TAG"
    else
      # Fall back to current latest tag
      CURRENT=$(get_latest_tag)
      if [ -n "$CURRENT" ]; then
        echo "$CURRENT" > "$STATE_FILE"
        log "Initialized with current latest tag: $CURRENT"
      else
        log "WARNING: Could not fetch initial tag"
      fi
    fi
  fi
  
  while true; do
    LATEST=$(get_latest_tag)
    
    if [ -z "$LATEST" ]; then
      log "WARNING: Could not fetch latest tag, retrying in ${CHECK_INTERVAL}s"
      sleep "$CHECK_INTERVAL"
      continue
    fi
    
    LAST_SEEN=""
    if [ -f "$STATE_FILE" ]; then
      LAST_SEEN=$(cat "$STATE_FILE" 2>/dev/null || true)
    fi
    
    if [ "$LATEST" != "$LAST_SEEN" ]; then
      log "New release detected: $LATEST (was: ${LAST_SEEN:-none})"
      
      # Write state BEFORE triggering to prevent duplicate triggers on crash/restart
      echo "$LATEST" > "$STATE_FILE"
      log "State updated to $LATEST (pre-trigger)"
      
      if trigger_workflow "$LATEST"; then
        log "Successfully processed release $LATEST"
      else
        log "ERROR: Failed to trigger workflow for $LATEST"
        # Don't revert state - the workflow concurrency group will handle dedup
        # and we don't want to keep retrying if there's an auth issue
      fi
    else
      log "No new release (current: $LATEST)"
    fi
    
    sleep "$CHECK_INTERVAL"
  done
}

main "$@"
