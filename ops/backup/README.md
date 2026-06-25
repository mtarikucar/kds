# KDS database backups — scheduling, off-site, restore

`scripts/backup-database.sh` makes a **verified** `pg_dump` (gzip integrity +
size + CREATE-count checks) and, when configured, ships it **off the VPS**.
This directory adds the missing piece: running it **on a schedule**, independent
of deploys.

## Why this exists (the gaps it closes)

- **Unbounded RPO.** The only automatic backup was the deploy-time step in
  `scripts/deploy.sh`. A release-free week meant 7 days of real orders /
  payments / fiscal receipts with **no backup**. The timer here runs every 6h.
- **No off-site copy.** Backups were written next to the database on the same
  single VPS — a disk failure / host loss / ransomware takes the DB *and* every
  backup. `backup-database.sh` now uploads each verified dump to an off-site
  target (Backblaze B2 / S3 / any rclone remote).
- **PII in the repo.** Backups were written under `$PROJECT_ROOT/backups`, which
  is how 20 real prod dumps (customer PII + `api_keys` + bcrypt hashes) ended up
  committed. They now default to `KDS_BACKUP_DIR=/var/lib/kds-deploy/backups`
  (outside the repo) and `backups/` is git-ignored.

## Install (systemd, recommended)

On the prod VPS, as root:

```sh
# 1) Off-site target + backup dir
cat >/etc/kds-backup.env <<'EOF'
KDS_BACKUP_DIR=/var/lib/kds-deploy/backups/database
# Pick ONE off-site target:
KDS_BACKUP_RCLONE_REMOTE=b2:kds-backups/prod      # needs `rclone config` done
# KDS_BACKUP_S3_BUCKET=my-bucket/kds/prod          # needs aws cli + creds
EOF
chmod 600 /etc/kds-backup.env

# 2) Point the unit at your repo checkout (edit WorkingDirectory + ExecStart)
#    then install + enable:
cp ops/backup/kds-backup.service ops/backup/kds-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now kds-backup.timer

# 3) Verify
systemctl list-timers kds-backup.timer
systemctl start kds-backup.service && journalctl -u kds-backup.service -n 40
```

### cron alternative

```cron
0 */6 * * * cd /opt/kds && KDS_BACKUP_DIR=/var/lib/kds-deploy/backups/database \
  KDS_BACKUP_RCLONE_REMOTE=b2:kds-backups/prod \
  /opt/kds/scripts/backup-database.sh prod >> /var/log/kds-backup.log 2>&1
```

## Alerting (do this — a silent backup failure is the dangerous case)

The script prints loud markers on failure:
- `OFFSITE-UPLOAD-FAILED …` — local copy exists but didn't reach off-site.
- `NO-OFFSITE-TARGET …` — no remote configured; on-box only.

Wire at least one of:
- Alert if **no successful backup in the last ~8h** (newest file in
  `KDS_BACKUP_DIR` older than 8h, or no off-site object in that window).
- Alert on the `*-FAILED` markers in `journalctl -u kds-backup.service`.

A quick staleness check (exit 1 if newest backup > 8h old):

```sh
find "${KDS_BACKUP_DIR:-/var/lib/kds-deploy/backups/database}" \
  -name 'backup_prod_*.sql.gz' -mmin -480 | grep -q . \
  || { echo "NO FRESH KDS BACKUP IN 8H"; exit 1; }
```

## Restore (quick reference)

> Verify this on a throwaway DB before you need it for real. (A full restore
> drill + PITR/WAL archiving are tracked separately — see the audit report.)

```sh
# 1) (off-site) pull the dump back if needed
rclone copy b2:kds-backups/prod/backup_prod_YYYYMMDD_HHMMSS.sql.gz .

# 2) restore into the running postgres container
gunzip -c backup_prod_YYYYMMDD_HHMMSS.sql.gz \
  | docker exec -i kds_postgres_prod psql -U postgres -d restaurant_pos_prod
```

For a clean-slate restore, drop/recreate the database first (PostGIS extension
is re-created by the dump). Match the `POSTGRES_USER` / DB name in
`.env.production`.
