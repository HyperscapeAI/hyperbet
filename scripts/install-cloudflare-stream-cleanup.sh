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
#   1. Verifies bun and cron are installed on the remote host.
#   2. Creates /root/hyperbet-cleanup/ on the host.
#   3. Copies scripts/cloudflare-stream-cleanup.ts into it.
#   4. Writes /root/hyperbet-cleanup/secrets.env (mode 600) with credentials.
#      This lives outside /tmp so it survives systemd-tmpfiles wipes on boot.
#   5. Writes /root/hyperbet-cleanup/run-cleanup.sh that sources secrets.env
#      and runs the TS script with bun.
#   6. Installs a root crontab entry running every 6 hours, logging to
#      /var/log/cloudflare-stream-cleanup.log.
#
# Requirements on the host:
#   - bun available at /usr/local/bin/bun (asserted below; install fails if absent)
#   - cron enabled + active (asserted below; install fails if absent)

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

echo "[install] asserting prerequisites on remote..."
ssh "${SSH_TARGET}" bash -s <<'PREREQ_EOF'
set -euo pipefail
fail=0
if [ ! -x /usr/local/bin/bun ]; then
  echo "PREREQ FAIL: /usr/local/bin/bun is missing or not executable. Install bun first (curl -fsSL https://bun.sh/install | bash)." >&2
  fail=1
fi
if ! command -v crontab >/dev/null 2>&1; then
  echo "PREREQ FAIL: crontab binary is missing. Install cron (apt-get install -y cron)." >&2
  fail=1
fi
if ! systemctl is-enabled cron >/dev/null 2>&1 && ! systemctl is-enabled crond >/dev/null 2>&1; then
  echo "PREREQ FAIL: cron service is not enabled. Run 'systemctl enable --now cron' (or crond)." >&2
  fail=1
fi
if ! systemctl is-active cron >/dev/null 2>&1 && ! systemctl is-active crond >/dev/null 2>&1; then
  echo "PREREQ FAIL: cron service is not running. Run 'systemctl start cron' (or crond)." >&2
  fail=1
fi
if [ "$fail" -ne 0 ]; then
  exit 1
fi
echo "[install] prerequisites OK"
PREREQ_EOF

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
CRON_COMMENT='# Cloudflare Stream cleanup — every 6 hours'
CRON_LINE='0 */6 * * * /root/hyperbet-cleanup/run-cleanup.sh >> /var/log/cloudflare-stream-cleanup.log 2>&1'
# Strip any prior version of this managed block (comment + cron line) so the
# installer is safely re-runnable without accumulating duplicates.
CURRENT="$(crontab -l 2>/dev/null | grep -vF 'run-cleanup.sh' | grep -vF 'Cloudflare Stream cleanup' || true)"
{
  [ -n "${CURRENT}" ] && printf '%s\n' "${CURRENT}"
  printf '%s\n%s\n' "${CRON_COMMENT}" "${CRON_LINE}"
} | crontab -
echo "[install] crontab:"
crontab -l
CRON_EOF

echo "[install] running one-shot dry-run via installed runner..."
# Use the installed runner so credentials stay inside the secrets.env file and
# never appear on the remote process command line (which would be visible to
# `ps`, /proc/*/cmdline, and auditd).
ssh "${SSH_TARGET}" bash -s <<'VERIFY_EOF' | head -5
set -euo pipefail
SECRETS=/root/hyperbet-cleanup/secrets.env
set -a
source "${SECRETS}"
set +a
export CLOUDFLARE_ACCOUNT_ID="${STREAM_CLOUDFLARE_ACCOUNT_ID:-}"
export CLOUDFLARE_API_TOKEN="${STREAM_CLOUDFLARE_API_TOKEN:-}"
cd /root/hyperbet-cleanup
/usr/local/bin/bun run cloudflare-stream-cleanup.ts --dry-run
VERIFY_EOF

echo "[install] done"
