#!/usr/bin/env bash
# Apply a versioned nginx vhost from this repo to the live host, safely.
#
#   sudo ops/nginx/apply.sh staging.hummytummy.com.conf
#   sudo ops/nginx/apply.sh hummytummy.com.conf            # see the warning in that file first
#
# It backs up the current target, copies the repo file in, runs `nginx -t`, and
# ONLY reloads if the test passes. On a failed test it restores the backup so the
# live config is never left broken. Run on the server (38.242.233.166) where the
# repo is checked out at /root/kds.
set -euo pipefail

CONF="${1:?usage: apply.sh <conf-filename>}"
SRC="$(cd "$(dirname "$0")" && pwd)/${CONF}"
DEST="/etc/nginx/sites-available/${CONF}"
LINK="/etc/nginx/sites-enabled/${CONF}"

[ -f "$SRC" ] || { echo "no such repo config: $SRC" >&2; exit 1; }

ts="$(date +%Y%m%d-%H%M%S)"
if [ -f "$DEST" ]; then
  cp -a "$DEST" "/root/nginx-${CONF}.bak.${ts}"
  echo "backed up current → /root/nginx-${CONF}.bak.${ts}"
fi

cp "$SRC" "$DEST"
ln -sfn "$DEST" "$LINK"

if nginx -t; then
  systemctl reload nginx
  echo "✅ applied ${CONF} and reloaded nginx"
else
  echo "❌ nginx -t failed — restoring backup, NOT reloading" >&2
  if [ -f "/root/nginx-${CONF}.bak.${ts}" ]; then
    cp -a "/root/nginx-${CONF}.bak.${ts}" "$DEST"
  fi
  exit 1
fi
