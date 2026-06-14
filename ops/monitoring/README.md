# kds Monitoring & Alerting (opt-in)

A self-contained, **opt-in** Prometheus + Alertmanager stack that scrapes the
kds backend's metrics endpoint and fires alerts on the "Monitoring & Alerting"
quality attribute. It does **not** touch the production/staging app stacks — it
lives entirely in this directory plus `docker-compose.monitoring.yml` at the
repo root.

## What it watches

The backend exposes Prometheus metrics at `GET /api/metrics`
(`backend/src/common/metrics/`). The alert rules in
[`alert.rules.yml`](./alert.rules.yml) reference only metrics that are actually
produced there:

| Alert | Expression (summary) | For | Severity |
|-------|----------------------|-----|----------|
| `OutboxDLQNonEmpty` | `outbox_dlq_depth > 0` | 5m | critical |
| `DeliveryDLQNonEmpty` | `delivery_dlq_depth > 0` | 10m | warning |
| `HighHttp5xxRate` | 5xx ratio from `http_request_duration_seconds_count{status_code=~"5.."}` > 5% | 10m | critical |
| `BackendDown` | `up{job="kds-backend"} == 0` | 2m | critical |
| `PaytrPaymentFailures` | `rate(payment_intents_total{result="paytr_failed"}[15m]) > 0` | 15m | critical |
| `WebhookDeliveryFailures` | `rate(webhook_delivery_total{result="failure"}[15m]) > 0` | 15m | warning |

> Note: the HTTP duration histogram labels requests with **`status_code`**
> (not `status`) — see `MetricsService.observeHttpRequest`. The 5xx rule
> matches on `status_code=~"5.."`.

## Files

- [`prometheus.yml`](./prometheus.yml) — scrape config. Job `kds-backend`
  scrapes `metrics_path: /api/metrics` at 15s, sending
  `Authorization: Bearer <METRICS_TOKEN>`. Loads `alert.rules.yml` and points
  Prometheus at the `alertmanager` service.
- [`alert.rules.yml`](./alert.rules.yml) — the alerting rules above, each with
  `labels` (severity/component) and `annotations` (summary/description).
- [`alertmanager.yml`](./alertmanager.yml) — minimal route grouped by
  `alertname` + `severity`, a critical-only fast-page sub-route, an inhibit
  rule, and a **placeholder** webhook receiver (email template commented out).
- [`../../docker-compose.monitoring.yml`](../../docker-compose.monitoring.yml)
  — the `prom/prometheus` + `prom/alertmanager` services that mount the above.

`prometheus.yml` and `alertmanager.yml` are **templates**: they contain
`__PLACEHOLDER__` tokens (e.g. `__METRICS_TOKEN__`, `__ALERT_WEBHOOK_URL__`).
Prometheus/Alertmanager do not expand env vars inside their own config files,
so each service's entrypoint runs a tiny `sed` to render the tokens from the
environment into a writable copy before launching the binary. The `__VAR__`
form is used so substitution can never collide with compose `${...}`
interpolation, shell expansion, or Prometheus' own `$labels`/`$value` rule
templating.

## The receiver endpoint and secrets are the operator's to set

This repo ships **no** real notification target or credentials. Before relying
on alerting you **must** set at least `ALERT_WEBHOOK_URL` to a destination you
own (a Slack Incoming-Webhook proxy, a PagerDuty/Opsgenie Events-API relay, or
a small internal handler). The email path is provided as a commented-out
template; uncomment it in `alertmanager.yml` and set the SMTP vars to use it.

## Run it

```bash
# 1) Point at a running backend and (optionally) its metrics token.
export KDS_BACKEND_TARGET=kds_backend_prod:3000   # container:port or host:port
export METRICS_TOKEN=...        # MUST match the backend's METRICS_TOKEN; empty = unauthenticated
export ALERT_WEBHOOK_URL=https://your-bridge.example/hook   # YOUR receiver

# 2) Join the app's docker network so the backend container name resolves.
docker network ls                                 # find the real network name
export KDS_NETWORK=kds-prod_kds_network           # e.g. <project>_<network>

# 3) Bring up the stack.
docker compose -f docker-compose.monitoring.yml up -d
```

- Prometheus UI: <http://localhost:9090> (Status → Targets should show
  `kds-backend` UP; Alerts shows the rules above).
- Alertmanager UI: <http://localhost:9093>.

To scrape a backend that is **not** on a docker network (e.g. a host port),
set `KDS_BACKEND_TARGET=host.docker.internal:3000` (or the host IP) and you can
drop the external `kds_app` network from the compose file.

## Validate the config locally

The bundled config is validated with the upstream tooling (no app code needed):

```bash
# Prometheus config + rules
docker run --rm -v "$PWD/ops/monitoring:/c" --entrypoint promtool \
  prom/prometheus:v2.53.0 check rules /c/alert.rules.yml

# Alertmanager config — render the placeholders first (amtool validates the
# smarthost as a real host:port, so the raw __TOKEN__ template is rejected on
# purpose). The compose entrypoint does this same sed at container start.
sed -e 's#__ALERT_WEBHOOK_URL__#http://localhost:5001/#' \
    -e 's#__ALERT_EMAIL_FROM__#alerts@example.invalid#' \
    -e 's#__ALERT_EMAIL_TO__#ops@example.invalid#' \
    -e 's#__ALERT_SMTP_SMARTHOST__#localhost:25#' \
    -e 's#__ALERT_SMTP_USERNAME__##' \
    -e 's#__ALERT_SMTP_PASSWORD__##' \
    ops/monitoring/alertmanager.yml > /tmp/alertmanager.rendered.yml
docker run --rm -v /tmp:/c --entrypoint amtool \
  prom/alertmanager:v0.27.0 check-config /c/alertmanager.rendered.yml
```

## Scope / non-goals

- Adds nothing to and edits nothing in `docker-compose.prod.yml` /
  `docker-compose.staging.yml`. It is a parallel, optional stack.
- No Grafana dashboards here — the RED data is exposed; dashboards can be added
  later against the same Prometheus.
- Long-term storage / HA Prometheus is out of scope; this is a single-node,
  operator-bootstrapped baseline.
