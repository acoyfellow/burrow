ARG SANDBOX_TOOLS_IMAGE=docker.io/cloudflare/sandbox:1.0.0
FROM ${SANDBOX_TOOLS_IMAGE} AS sandbox-tools

FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl python3 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=sandbox-tools /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
RUN git config --system user.name burrow \
  && git config --system user.email burrow@users.noreply.github.com \
  && git config --system init.defaultBranch main \
  && mkdir -p /workspace
WORKDIR /workspace
CMD ["sleep", "infinity"]
