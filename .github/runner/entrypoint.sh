#!/bin/bash
set -e

# Required environment variables
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${RUNNER_TOKEN:?RUNNER_TOKEN is required}"

# Optional environment variables with defaults
RUNNER_NAME="${RUNNER_NAME:-$(hostname)}"
RUNNER_LABELS="${RUNNER_LABELS:-self-hosted,linux,x64}"
RUNNER_WORKDIR="${RUNNER_WORKDIR:-_work}"

cd /home/runner/actions-runner

# Configure the runner
./config.sh --unattended \
    --url "https://github.com/${GITHUB_REPOSITORY}" \
    --token "${RUNNER_TOKEN}" \
    --name "${RUNNER_NAME}" \
    --labels "${RUNNER_LABELS}" \
    --work "${RUNNER_WORKDIR}" \
    --replace

# Cleanup function
cleanup() {
    echo "Removing runner..."
    ./config.sh remove --token "${RUNNER_TOKEN}" || true
}

trap cleanup EXIT

# Start the runner
./run.sh
