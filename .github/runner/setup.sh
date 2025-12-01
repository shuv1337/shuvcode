#!/bin/bash
set -e

# Self-hosted GitHub Actions Runner Setup Script
# 
# This script helps you set up a self-hosted runner for the shuvcode repository.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==================================="
echo "GitHub Actions Self-Hosted Runner Setup"
echo "==================================="
echo ""

# Check prerequisites
check_prerequisites() {
    echo "Checking prerequisites..."
    
    if ! command -v docker &> /dev/null; then
        echo "ERROR: Docker is not installed. Please install Docker first."
        echo "  Ubuntu: sudo apt-get install docker.io docker-compose-plugin"
        echo "  Or: https://docs.docker.com/engine/install/"
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        echo "ERROR: Docker daemon is not running or you don't have permission."
        echo "  Try: sudo systemctl start docker"
        echo "  Or add yourself to docker group: sudo usermod -aG docker $USER"
        exit 1
    fi
    
    echo "  Docker: OK"
    echo ""
}

# Get runner token
get_runner_token() {
    echo "To register a self-hosted runner, you need a registration token."
    echo ""
    echo "Get your token from:"
    echo "  https://github.com/kcrommett/shuvcode/settings/actions/runners/new"
    echo ""
    echo "Look for the './config.sh' command and copy the token after '--token'"
    echo ""
    read -p "Enter your runner token: " RUNNER_TOKEN
    
    if [ -z "$RUNNER_TOKEN" ]; then
        echo "ERROR: Token is required"
        exit 1
    fi
}

# Create .env file
create_env_file() {
    echo ""
    echo "Creating .env file..."
    
    read -p "Runner name (default: shuvcode-runner): " RUNNER_NAME
    RUNNER_NAME="${RUNNER_NAME:-shuvcode-runner}"
    
    cat > .env << EOF
GITHUB_REPOSITORY=kcrommett/shuvcode
RUNNER_TOKEN=${RUNNER_TOKEN}
RUNNER_NAME=${RUNNER_NAME}
RUNNER_LABELS=self-hosted,linux,x64,dev-server
EOF
    
    echo "  Created .env file"
}

# Build and start runner
start_runner() {
    echo ""
    echo "Building runner image (this may take a few minutes)..."
    docker compose build
    
    echo ""
    echo "Starting runner..."
    docker compose up -d
    
    echo ""
    echo "Runner started! Checking status..."
    sleep 5
    docker compose logs --tail=20
}

# Main
main() {
    check_prerequisites
    get_runner_token
    create_env_file
    start_runner
    
    echo ""
    echo "==================================="
    echo "Setup Complete!"
    echo "==================================="
    echo ""
    echo "Your self-hosted runner should now be visible at:"
    echo "  https://github.com/kcrommett/shuvcode/settings/actions/runners"
    echo ""
    echo "Useful commands:"
    echo "  View logs:     docker compose logs -f"
    echo "  Stop runner:   docker compose down"
    echo "  Restart:       docker compose restart"
    echo "  Scale to 3:    docker compose up -d --scale runner=3"
    echo ""
    echo "Next step: Update your workflows to use 'runs-on: self-hosted'"
}

main "$@"
