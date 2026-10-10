ARG NIX_IMAGE=registry.cloudflare.com/bfcb6ac5b3ceaf42a09607f6f7925823/nix-cf-proof@sha256:42f16e4c10bf7b078782e4fde6765010f0fd6d60d387d37b0cb964a25e534910
ARG SANDBOX_TOOLS_IMAGE=docker.io/cloudflare/sandbox:1.0.0
FROM ${SANDBOX_TOOLS_IMAGE} AS sandbox-tools
FROM docker.io/library/busybox:1.37-musl AS busybox

FROM ${NIX_IMAGE}
COPY --from=sandbox-tools /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
COPY --from=busybox /bin/busybox /opt/busybox/busybox
COPY prepare.sh /opt/prepare.sh
RUN ["/sandbox/bin/bash", "/opt/prepare.sh"]
ENV PATH=/sandbox/bin:/opt/busybox:/usr/local/bin \
    HOME=/root \
    GIT_AUTHOR_NAME=burrow \
    GIT_AUTHOR_EMAIL=burrow@users.noreply.github.com \
    GIT_COMMITTER_NAME=burrow \
    GIT_COMMITTER_EMAIL=burrow@users.noreply.github.com \
    SSL_CERT_FILE=/etc/ssl/certs/ca-bundle.crt
WORKDIR /workspace
CMD ["/sandbox/bin/sleep", "infinity"]
