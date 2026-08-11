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
# Usage:  bash scripts/push-via-openssl.sh [branch | refs/...]
#         (defaults to the current branch)
#
# A bare name is treated as a branch. A full ref is pushed as given, so a
# release tag goes out the same way:
#   bash scripts/push-via-openssl.sh refs/tags/v3.3.0
#
set -euo pipefail

REMOTE_URL="https://github.com/mtarikucar/kds.git"
CA_BUNDLE="/etc/ssl/certs/ca-certificates.crt"
TARGET="${1:-$(git rev-parse --abbrev-ref HEAD)}"
if [[ "$TARGET" == refs/* ]]; then
  REF="$TARGET"
else
  REF="refs/heads/${TARGET}"
fi
ZERO="0000000000000000000000000000000000000000"

TOKEN="$(gh auth token)"
if [[ -z "$TOKEN" ]]; then
  echo "ERROR: no gh token (run: gh auth login)" >&2
  exit 1
fi

# For an annotated tag this resolves to the tag object, which is what has to
# travel — the release workflow triggers on annotated tags.
if git rev-parse --verify --quiet "$REF" >/dev/null; then
  NEW="$(git rev-parse "$REF")"
else
  NEW="$(git rev-parse HEAD)"
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
PACK="$WORK/push.pack"
BODY="$WORK/body.bin"
RESP="$WORK/resp.bin"
ADV="$WORK/adv.bin"

# What the remote currently has at this ref. receive-pack takes the old value as
# a compare-and-swap: sending zeros means "create", which the server rejects
# with "cannot lock ref: reference already exists" once the branch is up. So a
# second push to the same branch needs the real old SHA.
#
# `git ls-remote` cannot be used to find it — it goes through git's own gnutls
# transport, which is the thing that does not work on this network. The
# advertisement is fetched over the same curl/OpenSSL path as the push.
curl -sS --cacert "$CA_BUNDLE" \
  -u "x-access-token:${TOKEN}" \
  -H "Accept: application/x-git-upload-pack-advertisement" \
  -o "$ADV" \
  "${REMOTE_URL}/info/refs?service=git-upload-pack"

adv_sha() {
  python3 - "$ADV" "$1" <<'PY'
import sys
data = open(sys.argv[1], "rb").read()
want = sys.argv[2]
i, out = 0, "0" * 40
while i + 4 <= len(data):
    try:
        n = int(data[i:i+4], 16)
    except ValueError:
        break
    if n == 0:
        i += 4
        continue
    line = data[i+4:i+n].decode("utf-8", "replace").split("\x00")[0].strip()
    parts = line.split(" ", 1)
    if len(parts) == 2 and parts[1] == want:
        out = parts[0]
        break
    i += n
print(out)
PY
}

OLD="$(adv_sha "$REF")"
REMOTE_MAIN="$(adv_sha refs/heads/main)"

if [[ "$OLD" == "$ZERO" ]]; then
  echo "remote ${REF}: absent → creating"
elif [[ "$OLD" == "$NEW" ]]; then
  echo "remote ${REF} is already at ${NEW:0:8} — nothing to push"
  exit 0
else
  echo "remote ${REF}: ${OLD:0:8} → ${NEW:0:8}"
  # Refuse to clobber: only fast-forward, same as a plain `git push`.
  if ! git merge-base --is-ancestor "$OLD" "$NEW" 2>/dev/null; then
    echo "ERROR: remote ${OLD:0:8} is not an ancestor of HEAD — fetch and rebase first" >&2
    exit 1
  fi
fi

# Send only what the remote is missing: everything reachable from NEW minus
# what it already has at this ref and on main. Excluding a hardcoded local
# `main` instead — which is what this did — produces an empty pack whenever the
# local branch has moved past it, and the server answers "missing necessary
# objects".
REVS="$NEW"
for have in "$OLD" "$REMOTE_MAIN"; do
  [[ "$have" == "$ZERO" ]] && continue
  git cat-file -e "$have" 2>/dev/null || continue   # not local → cannot exclude
  REVS+=$'\n'"^$have"
done

printf '%s\n' "$REVS" | git pack-objects --stdout --revs --delta-base-offset > "$PACK"
echo "pack: $(wc -c < "$PACK") bytes, $(printf '%s\n' "$REVS" | git rev-list --objects --stdin --revs | wc -l) objects"

# Build the receive-pack request body:
#   PKT-LINE( "<old> <new> <ref>\0 report-status" )  <flush-pkt 0000>  <packfile>
python3 - "$OLD" "$NEW" "$REF" "$PACK" "$BODY" <<'PY'
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

# "unpack ok" only says the packfile arrived intact; the ref can still be
# rejected on the next line ("ng <ref> <reason>"). Checking the first without
# the second reports success for a push that did not happen.
if [[ "$HTTP" == "200" ]] &&
   grep -qa "unpack ok" "$RESP" &&
   grep -qa "ok ${REF}" "$RESP" &&
   ! grep -qa "ng ${REF}" "$RESP"; then
  echo "✅ push OK — ${REF} is at ${NEW:0:8}"
else
  echo "❌ push did not confirm — see report above" >&2
  exit 1
fi
