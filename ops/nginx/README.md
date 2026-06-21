# Host nginx vhosts (source of truth)

`hummytummy.com` and `staging.hummytummy.com` both live on one VPS
(`38.242.233.166`) behind Cloudflare. The host nginx terminates Cloudflare's
traffic and routes each hostname to that environment's containers. **That
routing used to exist only on the server**, which is how staging drifted out of
sync with prod (staging kept the old "landing at `/`, SPA at `/app`" layout long
after prod moved the SPA to the domain root) — the SPA's `/assets/*` requests
then hit the landing app and the staging frontend wouldn't load.

These files make the routing version-controlled so the two environments can't
silently diverge again.

## Files
| File | Hostname | Notes |
|------|----------|-------|
| `staging.hummytummy.com.conf` | staging | Verified live (2026-06-22). Canonical. |
| `hummytummy.com.conf` | prod | **Reconstructed** — capture the live prod vhost and reconcile before treating as authoritative (see the header in the file). |
| `apply.sh` | — | Safe apply: backup → copy → `nginx -t` → reload only on pass. |

## Routing model (both envs identical, only ports differ)
- `/` → frontend SPA container (staging `5175`, prod `8080`). The SPA is built
  with Vite `base: '/'`, so it is served at the **root**.
- `/app` and `/app/*` → `301` to the root (legacy path; the old `/app` mount is gone).
- `/api/`, `/uploads/`, `/socket.io/` → backend container (staging `3002`, prod `3000`).
- The landing app (staging `3102`, prod `3100`) is **not** at the root anymore;
  marketing lives at `marketing.hummytummy.com` (separate service).

## Applying a change
```bash
# on the server, repo at /root/kds
sudo /root/kds/ops/nginx/apply.sh staging.hummytummy.com.conf
```
`apply.sh` keeps a timestamped backup at `/root/nginx-<conf>.bak.*` and never
leaves a broken config live (restores the backup if `nginx -t` fails).

## Keeping prod's file honest
Prod is already routing correctly; `hummytummy.com.conf` here is a best-effort
mirror. To make it authoritative, capture the live config once and commit it
verbatim:
```bash
ssh root@38.242.233.166 'nginx -T' | sed -n '/server_name hummytummy.com/,/^}/p'
```

## Not auto-applied
Deploys do **not** run `apply.sh` automatically — a bad vhost would take the site
down. Apply manually (or wire it into the deploy later, gated on `nginx -t`, once
both files are verified verbatim against the server).
