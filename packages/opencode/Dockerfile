FROM alpine AS base

# Disable the runtime transpiler cache by default inside Docker containers.
# On ephemeral containers, the cache is not useful
ARG BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=${BUN_RUNTIME_TRANSPILER_CACHE_PATH}
RUN apk add libgcc libstdc++ ripgrep git

FROM base AS build-amd64
COPY dist/shuvcode-linux-x64-baseline-musl/bin/shuvcode /usr/local/bin/shuvcode
COPY static /usr/local/bin/static

FROM base AS build-arm64
COPY dist/shuvcode-linux-arm64-musl/bin/shuvcode /usr/local/bin/shuvcode
COPY static /usr/local/bin/static

ARG TARGETARCH
FROM build-${TARGETARCH}
RUN shuvcode --version
ENTRYPOINT ["shuvcode"]
