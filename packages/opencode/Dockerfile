# Multi-stage Dockerfile that builds shuvcode from source
#
# Build:  docker build -t shuvcode:local .
# Run:    docker run -p 4096:4096 shuvcode:local

# Stage 1: Build the CLI binary and desktop UI
FROM oven/bun:1 AS builder

# Install git (needed by build script to detect branch)
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy everything (bun workspaces need the full structure)
COPY . .

# Install dependencies
RUN bun install

# Build the desktop UI
RUN cd packages/desktop && bun run build

# Build the CLI (all platforms - needed because runtime is Alpine/musl)
# Set channel to "docker" since .git is not available in build context
ENV OPENCODE_CHANNEL=docker
RUN cd packages/opencode && bun run build

# Copy desktop build to static directory
RUN cp -r packages/desktop/dist packages/opencode/static

# Stage 2: Runtime image
FROM alpine

ARG BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=${BUN_RUNTIME_TRANSPILER_CACHE_PATH}

RUN apk add --no-cache libgcc libstdc++ ripgrep git \
    && git config --global init.defaultBranch main

# Git user config - override these at runtime via environment variables
ENV GIT_AUTHOR_NAME="shuvcode" \
    GIT_AUTHOR_EMAIL="shuvcode@localhost" \
    GIT_COMMITTER_NAME="shuvcode" \
    GIT_COMMITTER_EMAIL="shuvcode@localhost"

# Detect architecture and copy appropriate binary
ARG TARGETARCH=amd64
COPY --from=builder /app/packages/opencode/dist/shuvcode-linux-x64-baseline-musl/bin/shuvcode /tmp/shuvcode-amd64
COPY --from=builder /app/packages/opencode/dist/shuvcode-linux-arm64-musl/bin/shuvcode /tmp/shuvcode-arm64
RUN cp /tmp/shuvcode-${TARGETARCH} /usr/local/bin/shuvcode && rm /tmp/shuvcode-*

COPY --from=builder /app/packages/opencode/static /usr/local/bin/static

RUN shuvcode --version

EXPOSE 4096

ENTRYPOINT ["shuvcode"]
CMD ["serve", "--port", "4096", "--hostname", "0.0.0.0"]
