#!/bin/bash
# Install the Cloudflare Stream cleanup job on a target host.
#
# Idempotent. Re-run after any host reprovision.
#
# Usage:
#   SSH_TARGET=root@46.4.80.150 \
#   CLOUDFLARE_ACCOUNT_ID=... \
#   CLOUDFLARE_API_TOKEN=... \
#     bash scripts/install-cloudflare-stream-cleanup.sh
#
# The installer:
#   1. Creates /root/hyperbet-cleanup/ on the host.
#   2. Copies scripts/cloudflare-stream-cleanup.ts into it.
#   3. Writes /root/hyperbet-cleanup/secrets.env (mode 600) with credentials.
#      This lives outside /tmp so it survives systemd-tmpfiles wipes on boot.
#   4. Writes /root/hyperbet-cleanup/run-cleanup.sh that sources secrets.env
#      and runs the TS script with bun.
#   5. Installs a root crontab entry running every 6 hours, logging to
#      /var/log/cloudflare-stream-cleanup.log.
#
# Requirements on the host:
#   - bun available at /usr/local/bin/bun
#   - cron service enabled (systemctl enable cron)

set -euo pipefail

SSH_TARGET="${SSH_TARGET:?SSH_TARGET is required (e.g. root@host)}"
CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_TS="${SCRIPT_DIR}/cloudflare-stream-cleanup.ts"

if [[ ! -f "${LOCAL_TS}" ]]; then
  echo "ERROR: ${LOCAL_TS} not found" >&2
  exit 1
fi

echo "[install] target=${SSH_TARGET}"

ssh "${SSH_TARGET}" "mkdir -p /root/hyperbet-cleanup"

scp -q "${LOCAL_TS}" "${SSH_TARGET}:/root/hyperbet-cleanup/cloudflare-stream-cleanup.ts"

ssh "${SSH_TARGET}" bash -s <<SECRETS_EOF
set -euo pipefail
cat > /root/hyperbet-cleanup/secrets.env <<SECRETS_FILE
STREAM_CLOUDFLARE_ACCOUNT_ID=${CLOUDFLARE_ACCOUNT_ID}
STREAM_CLOUDFLARE_API_TOKEN=${CLOUDFLARE_API_TOKEN}
SECRETS_FILE
chmod 600 /root/hyperbet-cleanup/secrets.env
SECRETS_EOF

ssh "${SSH_TARGET}" bash -s <<'RUNNER_EOF'
set -euo pipefail
cat > /root/hyperbet-cleanup/run-cleanup.sh <<'RUNNER_FILE'
#!/bin/bash
set -euo pipefail

SECRETS=/root/hyperbet-cleanup/secrets.env
if [ ! -f "${SECRETS}" ]; then
  echo "$(date -Iseconds) ERROR: missing ${SECRETS}" >&2
  exit 1
fi

set -a
source "${SECRETS}"
set +a

export CLOUDFLARE_ACCOUNT_ID="${STREAM_CLOUDFLARE_ACCOUNT_ID:-}"
export CLOUDFLARE_API_TOKEN="${STREAM_CLOUDFLARE_API_TOKEN:-}"

if [ -z "${CLOUDFLARE_ACCOUNT_ID}" ] || [ -z "${CLOUDFLARE_API_TOKEN}" ]; then
  echo "$(date -Iseconds) ERROR: missing account id or token in ${SECRETS}" >&2
  exit 1
fi

cd /root/hyperbet-cleanup
exec /usr/local/bin/bun run cloudflare-stream-cleanup.ts
RUNNER_FILE
chmod +x /root/hyperbet-cleanup/run-cleanup.sh
RUNNER_EOF

ssh "${SSH_TARGET}" bash -s <<'CRON_EOF'
set -euo pipefail
CRON_LINE='0 */6 * * * /root/hyperbet-cleanup/run-cleanup.sh >> /var/log/cloudflare-stream-cleanup.log 2>&1'
CURRENT="$(crontab -l 2>/dev/null || true)"
if echo "${CURRENT}" | grep -qF 'run-cleanup.sh'; then
  UPDATED="$(echo "${CURRENT}" | grep -v 'run-cleanup.sh' || true)"
else
  UPDATED="${CURRENT}"
fi
printf '%s\n' "${UPDATED}" "# Cloudflare Stream cleanup — every 6 hours" "${CRON_LINE}" \
  | awk 'NF || !printed_blank { print; if (NF==0) printed_blank=1 }' \
  | crontab -
echo "[install] crontab:"
crontab -l
CRON_EOF

echo "[install] running one-shot dry-run to verify..."
ssh "${SSH_TARGET}" "CLOUDFLARE_ACCOUNT_ID=${CLOUDFLARE_ACCOUNT_ID} CLOUDFLARE_API_TOKEN=${CLOUDFLARE_API_TOKEN} /usr/local/bin/bun run /root/hyperbet-cleanup/cloudflare-stream-cleanup.ts --dry-run" \
  | head -5

echo "[install] done"
