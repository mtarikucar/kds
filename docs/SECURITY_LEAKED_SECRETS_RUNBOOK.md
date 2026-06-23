# 🔐 Leaked-secrets remediation runbook

**Status: OPEN.** The repo `mtarikucar/kds` was made **public** (2026-06-23) to unblock GitHub Actions billing. Its **git history** exposes real secrets that must be treated as **compromised**.

## What leaked (history-only — current HEAD is clean)
| Commit | File | Secrets |
|---|---|---|
| `5d75ef44` ("3d trial") | `.env.default.backup` | `POSTGRES_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `EMAIL_PASSWORD`, `DESKTOP_RELEASE_API_KEY` |
| `bc5d8667` ("feat(ci)…") | `.env.test` | same set |

`.gitignore` now blocks all real `.env*` (only `*.example/.template/.sample` allowed), so this can't recur — but the historical commits remain readable on the public repo until purged.

## Remediation — in priority order

### 1. ROTATE (the only thing that truly neutralizes exposure) — **owner: user**
Assume every leaked value is compromised. Generate new values and update **GitHub → repo → Settings → Secrets and variables → Actions**, then redeploy:
- `JWT_SECRET`, `JWT_REFRESH_SECRET` — new random 64+ char. (Rotating logs out all sessions — expected.)
- `POSTGRES_PASSWORD` — rotate the actual Postgres role password on the VPS **and** the secret, then redeploy (prod + staging share it per memory).
- `EMAIL_PASSWORD` — change the mailbox password + the secret.
- `DESKTOP_RELEASE_API_KEY` — new key + the secret.
- **First check:** are these still the *current* prod values? The commits are old; if already rotated since, exposure is moot — confirm before churn.

### 2. PURGE history — **destructive, must be coordinated**
⚠️ Rewrites SHAs of ~50 branches and **breaks every existing clone** (12+ active parallel sessions saw work here). Do this only when other sessions are quiesced.
```bash
# from a fresh clone:
pip install git-filter-repo
git filter-repo --invert-paths \
  --path .env.default.backup --path .env.test \
  --path .env.development --path .env.docker --path .env.staging
git push --force --all origin
git push --force --tags origin
# every collaborator must re-clone afterwards
```

### 3. RE-PRIVATE — **owner: user; CI tradeoff**
`gh repo edit mtarikucar/kds --visibility private --accept-visibility-change-consequences` reduces exposure surface, but **re-blocks Actions billing** (the reason it was made public). Do this only after fixing GitHub billing (Settings → Billing → payment method / spending limit) so CI keeps working.

## Recommended sequence
Fix billing → re-private → rotate secrets + redeploy → purge history (coordinated) → re-clone.

> Rotation (#1) is the real fix and can happen independently of #2/#3. #2/#3 reduce ongoing exposure but don't undo what was already public — so #1 is mandatory regardless.
