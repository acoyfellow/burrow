ARG NIX_IMAGE
ARG SANDBOX_TOOLS_IMAGE=docker.io/cloudflare/sandbox:1.0.0
FROM ${SANDBOX_TOOLS_IMAGE} AS sandbox-tools
FROM docker.io/library/busybox:1.37-musl AS busybox
FROM docker.io/library/alpine:3.22 AS surfaces
ARG APK_PLAIN_HTTP=0
RUN if [ "$APK_PLAIN_HTTP" = 1 ]; then sed -i 's/https/http/' /etc/apk/repositories; fi && apk add --no-cache tmux chromium font-noto ncurses-terminfo-base nodejs npm python3 curl ripgrep jq xvfb x11vnc openbox xdotool gstreamer gst-plugins-base gst-plugins-good gst-plugins-bad libnice-gstreamer py3-gobject3

FROM ${NIX_IMAGE}
COPY --from=sandbox-tools /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
COPY --from=busybox /bin/busybox /opt/busybox/busybox
COPY --from=surfaces /usr /usr
COPY --from=surfaces /lib/ld-musl-x86_64.so.1 /lib/ld-musl-x86_64.so.1
COPY --from=surfaces /etc/fonts /etc/fonts
COPY --from=surfaces /etc/chromium /etc/chromium
COPY --from=surfaces /etc/terminfo /etc/terminfo
COPY --from=surfaces /etc/xdg /etc/xdg
COPY --from=surfaces /usr/share/X11 /usr/share/X11
COPY prepare.sh /opt/prepare.sh
COPY webrtc.py /opt/webrtc.py
RUN ["/sandbox/bin/bash", "/opt/prepare.sh"]
ENV PATH=/sandbox/bin:/opt/busybox:/usr/local/bin:/usr/bin \
    TERMINFO_DIRS=/etc/terminfo \
    HOME=/root \
    GIT_AUTHOR_NAME=coil \
    GIT_AUTHOR_EMAIL=coil@users.noreply.github.com \
    GIT_COMMITTER_NAME=coil \
    GIT_COMMITTER_EMAIL=coil@users.noreply.github.com \
    SSL_CERT_FILE=/etc/ssl/certs/ca-bundle.crt \
    GIT_SSL_CAINFO=/etc/ssl/certs/ca-bundle.crt
WORKDIR /workspace
CMD ["/sandbox/bin/sleep", "infinity"]
