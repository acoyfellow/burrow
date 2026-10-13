#!/sandbox/bin/bash
set -euo pipefail

cd /opt/busybox
for tool in $(./busybox --list); do
  [ -e "/sandbox/bin/$tool" ] || ln -s /opt/busybox/busybox "/opt/busybox/$tool"
done

mkdir -p /workspace /root /usr/bin
[ -e /bin/sh ] || ln -s /sandbox/bin/bash /bin/sh
ln -sf /sandbox/bin/env /usr/bin/env

echo 'root:x:0:0:root:/root:/sandbox/bin/bash' > /etc/passwd
echo 'root:x:0:' > /etc/group

mkdir -p /opt/pi-ext/calls /opt/pi-ext/agent-dir
cd /opt/pi-ext
printf '{"name":"coil-pi-host","private":true,"type":"module"}' > package.json
PATH=/usr/bin:/sandbox/bin:/opt/busybox SSL_CERT_FILE=/etc/ssl/certs/ca-bundle.crt NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-bundle.crt HOME=/root npm install --no-audit --no-fund --omit=dev @earendil-works/pi-coding-agent@1.2.0 typebox
