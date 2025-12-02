#!/bin/sh
# RSS-based release watcher for upstream opencode releases
# Polls the Atom feed and triggers a GitHub workflow when a new release is detected

set -eu

FEED_URL="https://github.com/sst/opencode/releases.atom"
STATE_FILE="${STATE_FILE:-/tmp/last-release-tag}"
CHECK_INTERVAL="${CHECK_INTERVAL:-60}"
GITHUB_REPO="${GITHUB_REPO:-Latitudes-Dev/shuvcode}"

log() {
  echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] $*"
}

get_latest_tag() {
  curl -fsSL "$FEED_URL" 2>/dev/null | sed -n 's/.*<title>\(v[^<]*\)<\/title>.*/\1/p' | head -1
}

trigger_workflow() {
  local tag="$1"
  log "Triggering upstream-sync workflow for $tag"
  
  if [ -z "${GITHUB_TOKEN:-}" ]; then
    log "ERROR: GITHUB_TOKEN not set, cannot trigger workflow"
    return 1
  fi
  
  curl -fsSL -X POST \
    -H "Accept: application/vnd.github+json" \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    "https://api.github.com/repos/$GITHUB_REPO/dispatches" \
    -d "{\"event_type\":\"upstream-release\",\"client_payload\":{\"tag\":\"$tag\"}}"
  
  log "Workflow triggered successfully"
}

main() {
  log "Starting release watcher"
  log "Feed: $FEED_URL"
  log "State file: $STATE_FILE"
  log "Check interval: ${CHECK_INTERVAL}s"
  log "Target repo: $GITHUB_REPO"
  
  # Initialize state file if it doesn't exist
  if [ ! -f "$STATE_FILE" ]; then
    log "Initializing state file with current latest tag"
    CURRENT=$(get_latest_tag)
    if [ -n "$CURRENT" ]; then
      echo "$CURRENT" > "$STATE_FILE"
      log "Initialized with tag: $CURRENT"
    else
      log "WARNING: Could not fetch initial tag"
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
      
      if trigger_workflow "$LATEST"; then
        echo "$LATEST" > "$STATE_FILE"
        log "State updated to $LATEST"
      else
        log "ERROR: Failed to trigger workflow, will retry"
      fi
    else
      log "No new release (current: $LATEST)"
    fi
    
    sleep "$CHECK_INTERVAL"
  done
}

main "$@"
