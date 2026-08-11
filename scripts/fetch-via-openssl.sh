#!/usr/bin/env bash
#
# fetch-via-openssl.sh — fetch from GitHub over an OpenSSL-verified HTTPS
# connection, working around git's gnutls backend rejecting the corporate
# TUSAS TLS-inspection root CA. Companion to push-via-openssl.sh.
#
# TLS verification is NOT disabled: curl verifies against the system CA bundle.
# Speaks git's smart-HTTP upload-pack protocol:
#   POST <repo>/git-upload-pack  with  want/have/done  ->  packfile
#
# Usage:  bash scripts/fetch-via-openssl.sh [remote-ref]   (default: main)
# Effect: downloads missing objects, updates refs/remotes/origin/<ref>, and
#         fast-forwards the local branch <ref> if it is an ancestor.
#
set -euo pipefail

REPO_API="repos/mtarikucar/kds"
REMOTE_URL="https://github.com/mtarikucar/kds.git"
CA_BUNDLE="/etc/ssl/certs/ca-certificates.crt"
REF_NAME="${1:-main}"

TOKEN="$(gh auth token)"
[[ -n "$TOKEN" ]] || { echo "ERROR: no gh token" >&2; exit 1; }

WANT="$(gh api "${REPO_API}/git/refs/heads/${REF_NAME}" --jq '.object.sha')"
echo "remote ${REF_NAME} = ${WANT}"

if git cat-file -e "$WANT" 2>/dev/null; then
  echo "already have ${WANT:0:8} locally — nothing to download."
else
  WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
  REQ="$WORK/req.bin"; RESP="$WORK/resp.bin"; PACK="$WORK/in.pack"

  # haves = all local ref tips, so the server sends a minimal (thin) pack.
  mapfile -t HAVES < <(git for-each-ref --format='%(objectname)' refs/heads refs/tags refs/remotes)

  python3 - "$WANT" "$REQ" "${HAVES[@]}" <<'PY'
import sys
want = sys.argv[1]; reqpath = sys.argv[2]; haves = sys.argv[3:]
def pkt(b): return b"%04x" % (len(b)+4) + b
caps = "thin-pack ofs-delta agent=fetch-via-openssl"
body  = pkt(f"want {want} {caps}\n".encode())
body += b"0000"                                   # flush after wants
for h in haves:
    body += pkt(f"have {h}\n".encode())
body += pkt(b"done\n")
open(reqpath, "wb").write(body)
PY

  echo "POST ${REMOTE_URL}/git-upload-pack (curl / OpenSSL, verified) ..."
  HTTP=$(curl -sS --cacert "$CA_BUNDLE" -u "x-access-token:${TOKEN}" \
    -H "Content-Type: application/x-git-upload-pack-request" \
    -H "Accept: application/x-git-upload-pack-result" \
    --data-binary "@${REQ}" -o "$RESP" -w "%{http_code}" \
    "${REMOTE_URL}/git-upload-pack")
  echo "HTTP ${HTTP}"
  [[ "$HTTP" == "200" ]] || { echo "ERROR: HTTP $HTTP" >&2; head -c 400 "$RESP" >&2; exit 1; }

  # Slice the packfile out of the response (skip the ACK/NAK pkt-lines).
  python3 - "$RESP" "$PACK" <<'PY'
import sys
data = open(sys.argv[1], "rb").read()
i = data.find(b"PACK")
if i < 0:
    sys.stderr.write("no PACK in response: " + repr(data[:200])); sys.exit(1)
open(sys.argv[2], "wb").write(data[i:])
PY

  git index-pack --fix-thin --stdin < "$PACK" >/dev/null
  git cat-file -e "$WANT" 2>/dev/null || { echo "ERROR: object still missing after unpack" >&2; exit 1; }
  echo "downloaded ${WANT:0:8} ✓"
fi

# Update remote-tracking ref, then fast-forward the local branch if safe.
git update-ref "refs/remotes/origin/${REF_NAME}" "$WANT"
LOCAL="$(git rev-parse --verify --quiet "refs/heads/${REF_NAME}" || true)"
if [[ -z "$LOCAL" ]]; then
  echo "no local ${REF_NAME}; origin/${REF_NAME} set to ${WANT:0:8}."
elif [[ "$LOCAL" == "$WANT" ]]; then
  echo "local ${REF_NAME} already at ${WANT:0:8}."
elif git merge-base --is-ancestor "$LOCAL" "$WANT"; then
  if [[ "$(git symbolic-ref --quiet HEAD || true)" == "refs/heads/${REF_NAME}" ]]; then
    git merge --ff-only "$WANT"
  else
    git update-ref "refs/heads/${REF_NAME}" "$WANT"
  fi
  echo "fast-forwarded ${REF_NAME}: ${LOCAL:0:8} -> ${WANT:0:8} ✓"
else
  echo "local ${REF_NAME} (${LOCAL:0:8}) diverged from origin (${WANT:0:8}) — left as-is (manual merge needed)."
fi
