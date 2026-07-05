# KDS observability stack (self-hosted)

Metrics + dashboards + logs + email alerting for the KDS platform. Runs as its
own Docker Compose project (`kds-monitoring`) — **separate from the app** so the
two lifecycles never interfere (`scripts/deploy.sh`'s prod swap uses
`--remove-orphans`, which would reap monitoring services if they lived in the
prod compose).

## Components

| Service | Purpose | Exposure |
|---|---|---|
| prometheus | scrapes metrics, evaluates alert rules | `127.0.0.1:9090` (loopback) |
| alertmanager | routes alerts → **email** (`ADMIN_EMAIL`) | `127.0.0.1:9093` (loopback) |
| grafana | dashboards | `grafana.hummytummy.com` (nginx + Grafana login) |
| loki + promtail | central log search (7-day retention) | internal only |
| node-exporter | host CPU/RAM/disk/load | internal only |
| cadvisor | per-container CPU/mem/restarts | internal only |
| postgres-exporter | DB connections/locks/`pg_up` | internal only |
| redis-exporter | Redis memory/hit-rate/`redis_up` | internal only |
| blackbox-exporter | external HTTPS uptime + TLS expiry | internal only |

Everything except Grafana is loopback-bound or has no host port; all containers
are resource-capped (`mem_limit`/`cpus`).

## Config layout

- `../../docker-compose.monitoring.yml` — the stack (project `kds-monitoring`).
- `prometheus.yml` — scrape jobs (TEMPLATE: `__METRICS_TOKEN__` rendered by the
  entrypoint). `rules/*.yml` — alert rules (app + infra + watchdog).
- `alertmanager.yml` — email receiver + watchdog route (TEMPLATE: SMTP from env).
- `loki/`, `promtail/`, `blackbox/` — component configs.
- `grafana/provisioning/**` — datasources + dashboard provider.
- `grafana/dashboards/*.json` — `KDS · RED (HTTP)`, `KDS · Business & queues`,
  `KDS · System overview`.
- `up.sh` — idempotent, degrade-only bring-up (called by `scripts/deploy.sh`).

Metric source: the backend's `GET /api/metrics` (`backend/src/common/metrics/*`),
Bearer-gated by `METRICS_TOKEN`.

## Go-live (operator, one-time)

1. **GitHub repo secrets:** add `METRICS_TOKEN` (32+ random) and
   `GRAFANA_ADMIN_PASSWORD`. The next tagged deploy renders both into
   `/root/kds/.env.production`.
2. **Cloudflare DNS:** `grafana` A record → `38.242.233.166` (proxied).
3. **On the VPS:**
   ```sh
   certbot certonly --webroot -w /var/www/certbot -d grafana.hummytummy.com
   sudo /root/kds/ops/nginx/apply.sh grafana.hummytummy.com.conf
   bash /root/kds/ops/monitoring/up.sh   # subsequent deploys auto-run this
   ```
4. **Verify:** log into `https://grafana.hummytummy.com`, confirm the KDS
   dashboards populate; check `http://127.0.0.1:9090/api/v1/targets` shows all
   targets `up`; fire a test alert:
   `docker exec kds_alertmanager amtool alert add TestFire severity=critical`
   and confirm the email at `ADMIN_EMAIL`.

Until `GRAFANA_ADMIN_PASSWORD` is set, `up.sh` skips cleanly (degrade-only) — the
app deploy is never affected.

## Deeper dashboards (import by ID)

The three shipped dashboards are the app-specific ones (RED / business /
system-overview). For exhaustive host/DB/Redis views, import the community
dashboards in Grafana (Dashboards → Import → by ID), all backed by the same
Prometheus datasource:

- **1860** — Node Exporter Full (host)
- **893** — Docker / cAdvisor (containers)
- **9628** — PostgreSQL (postgres-exporter)
- **763** — Redis (redis-exporter)

## Remove / roll back

```sh
docker compose -p kds-monitoring down        # keep data volumes
docker compose -p kds-monitoring down -v     # also drop TSDB/Loki/Grafana data
```
Zero impact on the app (`kds-prod` is a different project).
