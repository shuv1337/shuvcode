# Self-Hosted GitHub Actions Runner

This directory contains everything needed to run self-hosted GitHub Actions runners for the shuvcode repository.

## Why Self-Hosted?

- **No queue delays** - Jobs start immediately instead of waiting for GitHub-hosted runners
- **Faster builds** - Use your server's full resources
- **Pre-installed dependencies** - Bun, Node.js, Go, and Docker are pre-installed
- **No usage limits** - Run as many jobs as your server can handle

## Quick Start

### Prerequisites

- Docker and Docker Compose installed
- Access to the repository settings (to get runner token)

### Setup

1. **Get a runner registration token:**

   Go to: https://github.com/kcrommett/shuvcode/settings/actions/runners/new

   Copy the token from the `./config.sh --token <TOKEN>` command.

2. **Run the setup script:**

   ```bash
   cd .github/runner
   ./setup.sh
   ```

3. **Set the repository variable (one-time):**

   Go to: https://github.com/kcrommett/shuvcode/settings/variables/actions

   Create a new variable:
   - Name: `RUNNER_LABEL`
   - Value: `self-hosted` (or `self-hosted,linux,x64,dev-server` for specific labels)

## Manual Setup

If you prefer to set things up manually:

```bash
cd .github/runner

# Create .env file
cat > .env << EOF
GITHUB_REPOSITORY=kcrommett/shuvcode
RUNNER_TOKEN=<your-token>
RUNNER_NAME=shuvcode-runner
RUNNER_LABELS=self-hosted,linux,x64,dev-server
EOF

# Build and start
docker compose build
docker compose up -d
```

## Management Commands

```bash
# View logs
docker compose logs -f

# Stop runner
docker compose down

# Restart runner
docker compose restart

# Scale to multiple runners
docker compose up -d --scale runner=3

# Rebuild after updates
docker compose build --no-cache
docker compose up -d
```

## How Workflows Use Self-Hosted Runners

Workflows are configured to use a repository variable for the runner label:

```yaml
jobs:
  build:
    runs-on: ${{ vars.RUNNER_LABEL || 'ubuntu-latest' }}
```

- If `RUNNER_LABEL` is set to `self-hosted`, jobs run on your self-hosted runner
- If `RUNNER_LABEL` is not set, jobs fall back to GitHub-hosted `ubuntu-latest`

This allows you to easily switch between self-hosted and GitHub-hosted runners.

## Pre-installed Software

The runner image includes:

- **Node.js 22** - JavaScript runtime
- **Bun** - Fast JavaScript runtime and package manager
- **Go 1.24** - Go programming language
- **Docker CLI** - For container operations
- **GitHub CLI (gh)** - For GitHub API operations
- **Git** - Version control
- **Build essentials** - gcc, make, etc.

## Security Considerations

- Self-hosted runners execute code from your repository
- The runner runs in a Docker container for isolation
- Docker socket is mounted for docker-in-docker capabilities
- Runner token should be kept secret

## Troubleshooting

### Runner not appearing in GitHub

1. Check logs: `docker compose logs`
2. Verify token is correct in `.env`
3. Ensure the token hasn't expired (tokens are single-use)

### Jobs not running on self-hosted runner

1. Verify `RUNNER_LABEL` variable is set in repository settings
2. Check runner is online: https://github.com/kcrommett/shuvcode/settings/actions/runners
3. Ensure labels match between runner and workflow

### Container build fails

1. Ensure Docker has internet access
2. Try: `docker compose build --no-cache`
3. Check for disk space: `df -h`
