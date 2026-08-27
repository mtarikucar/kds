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
| `developer.hummytummy.com.conf` | prod (docs) | **Developer/integration** docs portal (Nextra) → `127.0.0.1:3200`. **Needs a user-side Cloudflare DNS record (`developer` → VPS IP) + a certbot cert before it resolves** (see the header in the file). |
| `help.hummytummy.com.conf` | prod (docs) | **Customer/operator** Help Center (Nextra) → `127.0.0.1:3201`. Split out of the developer portal. **Needs a user-side Cloudflare DNS record (`help` → VPS IP) + a certbot cert before it resolves** (see the header in the file). |
| `grafana.hummytummy.com.conf` | prod (obs) | Grafana dashboards. Same caveat as the other prod files. |
| `upstream-blue.conf` / `upstream-green.conf` | both | Blue/green upstream pair; the host includes `upstream-active.conf`, a symlink flipped by `scripts/deploy-blue-green.sh`. |
| `apply.sh` | — | Backup → **wholesale copy** → `nginx -t` → reload only on pass. Read the warning below before running it: it deletes live-only rules and `nginx -t` will not notice. |

## Routing model (both envs identical, only ports differ)
- `/` → frontend SPA container (staging `5175`, prod `8080`). The SPA is built
  with Vite `base: '/'`, so it is served at the **root**.
- `/app` and `/app/*` → `301` to the root (legacy path; the old `/app` mount is gone).
- `/api/`, `/uploads/`, `/socket.io/` → backend container (staging `3002`, prod `3000`).
- The landing app (staging `3102`, prod `3100`) is **not** at the root anymore;
  marketing lives at `marketing.hummytummy.com` (separate service).

## ⚠️ Applying a change — capture first, apply second

`apply.sh` does `cp "$SRC" "$DEST"`. That is a **wholesale replace**, not a
merge: every rule that exists only on the live server and not in the repo file
is deleted the moment you run it. `nginx -t` will not save you — it checks
**syntax**, and a config that has silently lost `/api/` routing is perfectly
valid syntax. **A blind `apply.sh` can take the site down**, and the failure
looks like a working nginx serving the wrong thing.

We know these files have live-only rules. On 2026-08-25 `https://hummytummy.com/robots.txt`
and `https://help.hummytummy.com/robots.txt` both answered **404 with an
`nginx/1.24.0 (Ubuntu)` body** — the *host* nginx, not the container — while
`/sitemap.xml` and an unknown path like `/zzz.txt` reached the app normally. A
rule that 404s that one path exists on the edge and appears nowhere in this
directory. `hummytummy.com.conf` still carries a `RECONSTRUCTED` header for the
same reason.

So the order is always:

```bash
# 1. CAPTURE the live vhost first. Never skip this.
#    The dump carries internal ports, upstream addresses and cert paths — keep
#    it local, do not paste it into a chat, an issue, or a CI log.
ssh root@38.242.233.166 'nginx -T' > /tmp/live-nginx.txt
#    Pull out one file's section. Match the full path: a loose pattern like
#    ".*hummytummy.com.conf" also matches staging. and help. and runs the
#    sections together.
awk '/^# configuration file /{p = ($0 ~ /sites-enabled\/hummytummy\.com\.conf:$/)} p' \
  /tmp/live-nginx.txt

# 2. RECONCILE: move every live-only rule INTO the repo file and commit it.
#    If you do not understand a live-only rule, that is a reason to keep it,
#    not to drop it. Ask before deleting.

# 3. APPLY, on the server, repo at /root/kds
sudo /root/kds/ops/nginx/apply.sh hummytummy.com.conf

# 4. VERIFY with curl — `nginx -t` passing proves nothing about routing.
for u in / /api/health /robots.txt /sitemap.xml; do
  printf '%s -> ' "$u"
  curl -s -o /dev/null -w '%{http_code}\n' "https://hummytummy.com$u"
done
# A 404 whose body says "nginx/1.24.0 (Ubuntu)" means the HOST nginx answered
# and the request never reached the app:
curl -s https://hummytummy.com/robots.txt | head -5
```

Step 4 is the one people skip. `apply.sh` keeps a timestamped backup at
`/root/nginx-<conf>.bak.*` and restores it if `nginx -t` fails — so rolling back
a *syntax* error is easy, and rolling back a *routing* error is only possible if
you noticed it:

```bash
sudo cp -a /root/nginx-hummytummy.com.conf.bak.<ts> /etc/nginx/sites-available/hummytummy.com.conf
sudo nginx -t && sudo systemctl reload nginx
```

## Drift detection (read-only)

`.github/workflows/nginx-drift.yml` runs daily and on demand. It SSHes to the
box, runs `nginx -T`, and compares the live server blocks against every file
here, failing the run when they disagree. It reports which files drifted and
which directives differ.

It is **read-only by design**. It never applies anything: handing CI a
credential that can rewrite the production edge is a trust boundary expansion,
and as above `nginx -t` cannot tell a correct config from a config that has lost
a route. The job tells you drift exists; a human still runs the four steps above.

The captured config never reaches the CI log. Live-only directive **values** are
printed as a salted fingerprint plus a coarse kind (`url`/`path`/`number`), so
internal ports, upstream addresses and cert paths stay off a page that anyone
with repo read access can open. Repo-side lines are printed verbatim — they are
already committed here, so echoing them discloses nothing new; a live-only value
that happens to also appear somewhere in the repo file is likewise printed, and
labelled as such. The salt is fresh per run, so a fingerprint can be compared
with other fingerprints in the same report but not brute-forced against a
guessed value.

If you add a new `.conf` to this directory, add it to that workflow's `TRACKED`
list too; the job fails on an untracked file rather than quietly not checking it.
`upstream-blue.conf` / `upstream-green.conf` are intentionally untracked —
the host includes `upstream-active.conf`, a symlink `scripts/deploy-blue-green.sh`
flips between them, so which one is live is not drift.

## Not auto-applied
Deploys do **not** run `apply.sh` automatically — a bad vhost would take the site
down, and `release-deploy.yml` never touches nginx at all. Applying stays manual
until every file here has been reconciled verbatim against the server and the
drift job has been green for a while.
