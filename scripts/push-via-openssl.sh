#!/usr/bin/env bash
#
# push-via-openssl.sh — push the current branch to GitHub over an OpenSSL-verified
# HTTPS connection, working around git's gnutls backend rejecting the corporate
# TUSAS TLS-inspection root CA (which lacks a KeyUsage extension; OpenSSL accepts
# it, gnutls does not).
#
# TLS verification is NOT disabled: curl verifies GitHub's presented certificate
# against the system CA bundle (/etc/ssl/certs/ca-certificates.crt), exactly as
# `gh` and the system `curl` already do successfully on this network.
#
# It speaks git's smart-HTTP receive-pack protocol directly:
#   POST <repo>/git-receive-pack  with  <pkt-line ref-update><flush><packfile>
#
# Usage:  bash scripts/push-via-openssl.sh [branch]
#         (defaults to the current branch)
#
set -euo pipefail

REMOTE_URL="https://github.com/mtarikucar/kds.git"
CA_BUNDLE="/etc/ssl/certs/ca-certificates.crt"
BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
REF="refs/heads/${BRANCH}"
ZERO="0000000000000000000000000000000000000000"

TOKEN="$(gh auth token)"
if [[ -z "$TOKEN" ]]; then
  echo "ERROR: no gh token (run: gh auth login)" >&2
  exit 1
fi

NEW="$(git rev-parse HEAD)"

# The remote already has main; only send objects reachable from HEAD but not
# from origin/main (a normal, self-contained pack — no --thin).
BASE="$(git rev-parse main)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
PACK="$WORK/push.pack"
BODY="$WORK/body.bin"
RESP="$WORK/resp.bin"

printf '%s\n^%s\n' "$NEW" "$BASE" | git pack-objects --stdout --revs --delta-base-offset > "$PACK"
echo "pack: $(wc -c < "$PACK") bytes, $(printf '%s\n^%s\n' "$NEW" "$BASE" | git rev-list --objects --stdin --revs | wc -l) objects"

# Build the receive-pack request body:
#   PKT-LINE( "<old> <new> <ref>\0 report-status" )  <flush-pkt 0000>  <packfile>
python3 - "$ZERO" "$NEW" "$REF" "$PACK" "$BODY" <<'PY'
import sys
old, new, ref, packpath, bodypath = sys.argv[1:6]
caps = "report-status"
cmd = f"{old} {new} {ref}\x00{caps}\n".encode()
pkt = f"{len(cmd)+4:04x}".encode() + cmd
with open(packpath, "rb") as f:
    pack = f.read()
with open(bodypath, "wb") as f:
    f.write(pkt)          # ref-update command
    f.write(b"0000")      # flush-pkt
    f.write(pack)         # packfile
PY

echo "POST ${REMOTE_URL}/git-receive-pack (curl / OpenSSL, verified against system CA) ..."
HTTP=$(curl -sS --cacert "$CA_BUNDLE" \
  -u "x-access-token:${TOKEN}" \
  -H "Content-Type: application/x-git-receive-pack-request" \
  -H "Accept: application/x-git-receive-pack-result" \
  --data-binary "@${BODY}" \
  -o "$RESP" -w "%{http_code}" \
  "${REMOTE_URL}/git-receive-pack")

echo "HTTP ${HTTP}"
echo "--- server report ---"
# report-status is plain pkt-lines: strip the 4-hex length prefixes for display.
python3 - "$RESP" <<'PY'
import sys
data = open(sys.argv[1], "rb").read()
i = 0
while i + 4 <= len(data):
    ln = data[i:i+4]
    try:
        n = int(ln, 16)
    except ValueError:
        sys.stdout.write(data[i:].decode("utf-8", "replace")); break
    if n == 0:
        i += 4; continue
    sys.stdout.write(data[i+4:i+n].decode("utf-8", "replace"))
    i += n
PY
echo "---------------------"

if [[ "$HTTP" == "200" ]] && grep -qa "unpack ok" "$RESP"; then
  echo "✅ push OK — set upstream and confirm with: git branch --set-upstream-to=origin/${BRANCH} ${BRANCH}"
else
  echo "❌ push did not confirm — see report above" >&2
  exit 1
fi
