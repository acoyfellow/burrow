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
