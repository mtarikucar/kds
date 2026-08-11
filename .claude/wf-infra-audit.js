export const meta = {
  name: 'infra-prod-readiness-audit',
  description: 'Deep multi-agent infrastructure production-readiness audit of the kds SaaS (16 dimensions, adversarially verified, synthesized)',
  phases: [
    { title: 'Audit', detail: '16 specialist finders read real source per infra dimension' },
    { title: 'Verify', detail: 'adversarially refute every blocker/critical/high finding against the code' },
    { title: 'Synthesize', detail: 'prioritized go-live readiness report' },
  ],
}

const ROOT = '/home/tarik/Projects/kds'

const SHARED = `You are a senior SRE / platform engineer performing a PRODUCTION-READINESS infrastructure audit.

CONTEXT: "kds" (brand: HummyTummy) is a multi-tenant restaurant SaaS. Stack: NestJS + Prisma backend on PostgreSQL/PostGIS + Redis; Next.js frontend; a Tauri/Rust desktop POS; an on-prem device mesh (local-bridge agent + C++ edge devices); delivery-platform integrations; nginx reverse proxy; GHCR image build with a tag->deploy CI; Prometheus/Alertmanager monitoring (opt-in). It is ALREADY shipping to production via per-change version tags and is about to onboard REAL PAYING TENANTS at growing scale. Repo root: ${ROOT} (backend in ./backend, frontend in ./frontend, CI in .github/workflows, infra in ./ops, compose files + deploy.sh + ./scripts at root).

YOUR JOB: deeply audit ONE infrastructure dimension for real-user production readiness. READ THE ACTUAL SOURCE (use Read/Grep/Bash freely; do NOT modify any files). Ground EVERY finding in concrete evidence with exact file:line references. Reason about what actually happens at runtime under: real multi-tenant load, MORE THAN ONE backend replica, partial failures (DB/Redis/network down), and live deploys/migrations — not what the code aspires to.

SEVERITY:
- blocker = will break or endanger real users / data / money, or cause outage or data-loss; must fix before onboarding real tenants.
- critical = serious risk that will bite soon under real load/scale or on the first incident.
- high = important hardening needed before scaling beyond the first few tenants.
- medium = should fix; meaningful but not urgent.
- low / info = nice-to-have / note.

RULES:
- Prefer FEWER, HIGH-CONFIDENCE, SPECIFIC findings over generic checklist advice. Every finding must be tied to real code/config in THIS repo.
- If something is actually done WELL, capture it under "strengths" (the report must credit existing maturity, not just complain).
- If you recall a prior review flagging something, VERIFY its current state on the actual files before reporting it — do not trust memory.
- Distinguish single-instance behavior from multi-replica behavior explicitly where relevant.`

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    dimension: { type: 'string' },
    summary: { type: 'string', description: 'overall production-readiness state of this dimension in 2-4 sentences' },
    strengths: { type: 'array', items: { type: 'string' }, description: 'what is already done well, with file evidence' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'critical', 'high', 'medium', 'low', 'info'] },
          area: { type: 'string' },
          evidence: { type: 'string', description: 'exact file:line references and the concrete fact observed' },
          why_it_matters: { type: 'string', description: 'concrete production / real-user impact' },
          recommendation: { type: 'string', description: 'specific, actionable fix' },
          effort: { type: 'string', enum: ['trivial', 'small', 'medium', 'large'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['title', 'severity', 'evidence', 'why_it_matters', 'recommendation', 'effort', 'confidence'],
      },
    },
  },
  required: ['dimension', 'summary', 'strengths', 'findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['confirmed', 'partly', 'already_mitigated', 'refuted'] },
    reasoning: { type: 'string' },
    corrected_severity: { type: 'string', enum: ['blocker', 'critical', 'high', 'medium', 'low', 'info'] },
    evidence_checked: { type: 'string', description: 'which files/lines you actually opened to verify' },
  },
  required: ['verdict', 'reasoning', 'corrected_severity', 'evidence_checked'],
}

const DIMENSIONS = [
  {
    key: 'cicd',
    title: 'CI/CD & deployment pipeline safety',
    scope: `Read: .github/workflows/release-deploy.yml, test-deploy.yml, db-baseline.yml, quality-gates.yml, marketing-deploy-bootstrap.yml, seed-runner.yml, staging-diagnose.yml; deploy.sh; scripts/deploy.sh, scripts/deploy-production.sh, scripts/health-check.sh, scripts/db-migration-doctor.sh; .last-deployment-images; docs/DEPLOYMENT.md.
Judge: the tag->build->push(GHCR)->deploy flow; are images immutable/digest-pinned or mutable tags (latest) that can drift; migration ordering vs app start (do migrations run before/atomically with the new image; what if a migration fails mid-deploy); rollback story (can you revert to the prior tag fast; is DB rollback possible); is the container swap health-GATED or a blind restart/sleep; deploy concurrency/locking (two tags racing); secret injection into CI/host; manual footguns; the known transient GHCR-propagation race on swap-verify; staging<->prod parity; who can trigger prod deploy.`,
  },
  {
    key: 'containers',
    title: 'Container images & runtime hardening',
    scope: `Read: backend/Dockerfile, frontend/Dockerfile, docker-compose.prod.yml, docker-compose.staging.yml, any .dockerignore. grep for USER, HEALTHCHECK, deploy/resources/mem_limit, restart:.
Judge: base image pinning (tag vs digest) and OS currency; multi-stage build & final image size; runs as non-root? capabilities dropped / read-only rootfs?; HEALTHCHECK present and meaningful; restart policy; CPU/memory limits & OOM behavior; dev/build dependencies leaking into the runtime image; secret handling (build args vs runtime env vs baked-in); reproducibility (npm ci + lockfile); exposed ports; volume mounts for uploads/data; .dockerignore excluding .env/.git/node_modules.`,
  },
  {
    key: 'database',
    title: 'PostgreSQL/PostGIS & Prisma data layer',
    scope: `Read: backend/src/prisma/prisma.service.ts, prisma.module.ts; how DATABASE_URL / connection_limit / pool params are set (grep connection_limit, pool, pgbouncer, datasources); backend/prisma/schema.prisma (focus on @@index/@@unique/@relation, especially tenant/branch scoping columns and high-write tables — outbox, caller_events, traffic/heatmap, sessions, tokens); grep withAdvisoryLock / pg_advisory across src; .github/workflows/db-baseline.yml; scripts/db-migration-doctor.sh.
Judge: Prisma pool size per process vs replica count vs Postgres max_connections (exhaustion risk); is pgbouncer used; the advisory-lock acquire/release-on-different-pooled-connection leak (session-scoped lock leak stalling crons); missing indexes on hot filter/sort/FK/tenant columns; missing unique index on tokenHash (auth seq-scan); statement_timeout / query timeouts; destructive or long-lock DDL applied during live deploy; unbounded table growth & retention (outbox, events, logs, heatmap cache, sessions); tenant data isolation enforced in queries.`,
  },
  {
    key: 'redis',
    title: 'Redis usage & resilience',
    scope: `grep across backend/src for ioredis, 'redis', cache-manager, CacheModule, bull, bullmq, createClient, REDIS_URL; Read src/common/adapters/redis-io.adapter.ts and how it is registered in src/main.ts / app.module.ts.
Judge: exactly what Redis backs (socket.io adapter? cache? throttle store? queues? sessions/refresh? locks?); connection resilience & retry/reconnect strategy; the documented boot-hang when Redis is unavailable (does the app fail open, fail closed, or hang); maxmemory/eviction policy assumptions; persistence (AOF/RDB) for anything that must survive restart; is Redis a single instance SPOF; AUTH/TLS on the connection; key namespacing & TTLs (leak/growth); whether caches/throttle default to IN-MEMORY (per-process) instead of Redis, which breaks multi-replica.`,
  },
  {
    key: 'ratelimit',
    title: 'Rate limiting, throttling & abuse protection',
    scope: `grep ThrottlerModule, ThrottlerGuard, @Throttle, ThrottlerStorage, @SkipThrottle across backend/src; Read app.module.ts ThrottlerModule config and src/common/guards/machine-throttler.guard.ts.
Judge: does ThrottlerModule actually define a 'default' named throttler (prior review claim: it does NOT, so ~60 @Throttle({default}) are INERT — verify on current code); throttle storage backend (in-memory default counts PER PROCESS, so behind a load balancer / multiple replicas the effective limit multiplies and is bypassable); brute-force protection on auth (login/refresh/OTP/password-reset); protection on expensive endpoints (reports/exports/search/analytics/file upload) and on PUBLIC unauthenticated endpoints (QR menu, self-pay, partner display, webhooks); global request body-size limits; per-tenant quotas; IP source correctness behind nginx (trust proxy / X-Forwarded-For).`,
  },
  {
    key: 'secrets',
    title: 'Secrets & configuration management',
    scope: `Read: .env.production.example, .env.production.template; backend/src/config/*; src/main.ts and app.module.ts for ConfigModule validation; grep process.env across backend/src for required vars and DEFAULT FALLBACKS like ('|| "..."'), especially JWT/secret/password; docs/SECURITY_LEAKED_SECRETS_RUNBOOK.md; .gitignore.
Judge: is there boot-time config validation that fails fast on missing critical envs (DATABASE_URL/JWT secrets/Redis/PayTR/etc.) or does it silently default; hardcoded or weak fallback secrets in code; JWT — separate strong access vs refresh secrets, strength, expiry; the KNOWN leaked-secrets-in-public-git-history risk (repo is public; .env.* committed historically with REAL prod JWT_SECRET/POSTGRES_PASSWORD/EMAIL_PASSWORD/DESKTOP_RELEASE_API_KEY) — confirm whether still unrotated and the blast radius; how secrets reach containers (host env files) and their on-host protection; staging vs prod secret separation; rotation story.`,
  },
  {
    key: 'observability',
    title: 'Logging, metrics, tracing & alerting',
    scope: `Read: backend/src/common/services/logger.service.ts, src/common/middleware/request-logger.middleware.ts, src/sentry.config.ts, src/main.ts (logger + sentry init); ops/monitoring/prometheus.yml, alert.rules.yml, alertmanager.yml, README.md; src/modules/health-dashboard/*; grep METRICS_TOKEN, /metrics, prom-client.
Judge: structured (JSON) logging vs raw console; prod log level; PII/secret leakage in logs (request logger dumping bodies/headers/tokens/auth?); Sentry actually initialized in prod (DSN, environment, release, sourcemaps, beforeSend PII scrub, error sampling); is there a real /metrics endpoint, is it auth-gated (METRICS_TOKEN), and does it export meaningful APP/business metrics or only node defaults; alert rules — do any actually page on error rate / latency / saturation / app-down / cert-expiry, or is the rule set thin; request/correlation IDs for tracing; log retention/shipping; audit logging of sensitive actions. NOTE the monitoring stack is OPT-IN/separate — assess whether it is realistically running in prod.`,
  },
  {
    key: 'scaling',
    title: 'Horizontal scaling & in-process statefulness',
    scope: `grep for module-level mutable state: 'new Map(', 'new Set(', private static, singleton caches (e.g. analyticsHeatmapCache), in-memory throttle/cache; grep @Cron / ScheduleModule / CronExpression and check each for distributed locking (withAdvisoryLock); check redis-io adapter is actually wired in main.ts for prod; grep for local filesystem writes (backend/uploads, backend/storage, multer dest, fs.writeFile) used for user content.
Judge: can you safely run 2+ backend replicas? Enumerate concrete blockers: (a) in-memory state that diverges per replica (caches, throttle counters, websocket room membership); (b) @Cron jobs that fire on EVERY replica without a distributed lock -> double execution (double-charge / double-email / double-fanout); (c) websocket fan-out that only reaches clients on the same replica unless a Redis adapter is enabled; (d) user uploads written to local disk not shared across replicas -> 404/lost files behind the LB; (e) sticky-session requirements. State whether the app is currently single-instance-only and what it would take to scale out.`,
  },
  {
    key: 'security',
    title: 'Application & infra security hardening',
    scope: `Read: src/main.ts (helmet, cors, cookie-parser, body limits, trust proxy); grep helmet, cors, cookieParser, sameSite, secure:, httpOnly; cookie/refresh-token setup; file upload handling (multer config, allowed types, size, path); ops/nginx/*.conf for TLS/headers; grep for SSRF surface in outbound webhook/integration HTTP callers (axios/fetch to tenant-supplied URLs).
Judge: security headers (Helmet/CSP/HSTS) on responses; CORS allowlist (must not be reflective '*' with credentials); refresh-token cookie flags (httpOnly+secure+sameSite) — note memory says tokens are deliberately NOT in localStorage, confirm; HTTPS enforcement/HSTS at edge; request body-size limits (DoS); file upload validation (type/size/magic bytes) and path-traversal/storage; exposure of superadmin/metrics/health/internal endpoints to the public; tenant isolation at the guard layer (BranchGuard/tenant scoping) holes; SSRF in webhook/delivery/integration callers to tenant-controlled URLs; mass-assignment / overposting via DTOs.`,
  },
  {
    key: 'realtime',
    title: 'WebSocket scaling & on-prem device mesh',
    scope: `Read: src/common/adapters/redis-io.adapter.ts; grep @WebSocketGateway, @SubscribeMessage, server.emit, .to(, join(; src/modules/device-mesh/* (command-queue.service.ts, heartbeat, token/pair), local-bridge, desktop-app module; grep tokenExpiresAt / renewal / refresh for device & bridge tokens.
Judge: socket.io multi-instance scaling (is the Redis adapter actually enabled in prod main.ts, or do emits stay on one replica); socket connection AUTH and per-room AUTHORIZATION (can a client subscribe to another tenant's/branch's room); reconnection, backpressure, unbounded room growth; the on-prem device-mesh + local-bridge token TTL with NO renewal path (prior review: whole device+bridge fleet stops authenticating at the fixed TTL with no self-recovery) — confirm on current code; heartbeat/liveness & offline behavior; command-queue durability across restarts.`,
  },
  {
    key: 'jobs',
    title: 'Background jobs, crons & outbox reliability',
    scope: `Read: src/modules/outbox/outbox.service.ts, outbox-worker.service.ts; src/modules/superadmin/services/superadmin-outbox.service.ts; grep @Cron, DomainEventBus, EventEmitter2, withAdvisoryLock, OutboxService.append; webhook fanOut.
Judge: outbox transactional-append correctness (is the row+event created in ONE transaction, or a separate swallowed .append().catch() that loses events on retry — recurring footgun in this codebase); at-least-once delivery + DLQ + retry/backoff; cron distributed locking across replicas (or double execution); idempotency/dedup of consumers; the DomainEventBus that SWALLOWS listener throws by design (a consumer that rethrows 'for retry' is dead AND can abort fan-out) — find any remaining rethrowers; poison-message handling; outbox/event table growth & cleanup; worker crash recovery & reclaim backoff.`,
  },
  {
    key: 'health',
    title: 'Health checks, graceful shutdown & deploy gating',
    scope: `Read: src/main.ts (enableShutdownHooks, SIGTERM/SIGINT handlers, app.close); src/modules/health-dashboard/health-dashboard.controller.ts & service; docker-compose.prod.yml/staging.yml healthcheck + depends_on; scripts/health-check.sh; nginx upstream config.
Judge: are liveness and readiness SEPARATE (readiness must reflect DB+Redis dependency health; liveness must NOT, to avoid restart storms); does graceful shutdown drain in-flight requests and close DB/Redis/socket connections on SIGTERM (Nest enableShutdownHooks + Postgres/Redis disconnect); startup ordering (depends_on healthcheck conditions); does the deploy verify actually GATE on a health endpoint or just sleep; connection draining at the proxy during the container swap (zero-downtime?); behavior on OOM/crash restart; is the public health endpoint leaking internal info.`,
  },
  {
    key: 'nginx',
    title: 'Reverse proxy / TLS / edge',
    scope: `Read: ops/nginx/hummytummy.com.conf, staging.hummytummy.com.conf, developer.*, help.*; ops/nginx/apply.sh and README.
Judge: TLS protocols/ciphers, HTTP->HTTPS redirect, HSTS; websocket upgrade headers (Upgrade/Connection) for socket.io/SSE; proxy_read_timeout/send_timeout adequate for long requests (reports, uploads, SSE) without being unbounded; client_max_body_size for file uploads (and DoS ceiling); gzip/brotli; static asset caching; EDGE rate limiting (limit_req / limit_conn) as a first line of defense; security headers at the edge; upstream health/failover & keepalive; request buffering for large uploads; real client IP forwarding (set_real_ip_from / X-Forwarded-For) so app-level throttling & logging see the true IP.`,
  },
  {
    key: 'backups',
    title: 'Backups & disaster recovery',
    scope: `Read: scripts/backup-database.sh; the backups/ directory; grep for any backup cron/schedule (in CI, compose, or host docs); docker-compose volume definitions for Postgres/Redis/uploads data; docs/DEPLOYMENT.md DR section.
Judge: is database backup AUTOMATED/scheduled or only a manual script; OFFSITE/remote copy or same-host (lost with the server); encryption at rest of backups; retention policy; is RESTORE actually tested/documented; PITR/WAL archiving for low RPO; what else needs backup (user uploads on local disk, any durable Redis data); volume persistence config so data survives container recreation; protection against accidental data-loss (no DROP/destructive ops in deploy migrations; backup BEFORE migrate). State realistic RPO/RTO.`,
  },
  {
    key: 'performance',
    title: 'Performance & capacity on hot paths',
    scope: `grep for findMany without take/pagination, large 'include' trees (N+1 / over-fetch), synchronous heavy work (PDF/Excel/report/QR/image generation, ESC/POS rendering) in request handlers; identify HOT/HIGH-TRAFFIC paths: public QR menu & ordering, self-pay, POS order create, KDS streams, analytics/reports. Read a few of those services/controllers.
Judge: N+1 and over-fetching on hot endpoints; unbounded queries (no pagination) that grow with tenant data; missing indexes backing hot filters/sorts; CPU-heavy synchronous work blocking the Node event loop inside a request (should be queued/streamed); caching of expensive read paths — especially the PUBLIC QR menu which every diner hits (cache + CDN?); connection-pool sizing vs expected concurrency; large JSON payloads & response compression; image/asset serving from the app process vs CDN.`,
  },
  {
    key: 'supplychain',
    title: 'Dependencies & supply chain',
    scope: `Read root package.json, backend/package.json, frontend/package.json; try Bash: 'cd ${ROOT}/backend && npm audit --omit=dev --json' and same for frontend (if offline/blocked, fall back to inspecting versions). Check lockfiles exist. Check core framework versions (NestJS, Next.js, Prisma, node base image).
Judge: known HIGH/CRITICAL CVEs in production dependencies; outdated core frameworks (security-relevant lag) for Nest/Next/Prisma; lockfile committed + npm ci used (reproducible, integrity-checked installs); risky postinstall scripts; pinned vs floating (^) versions on security-sensitive deps; base image OS package CVEs; unmaintained/abandoned deps in the auth/crypto/payment path. Keep it to genuinely actionable items, not the full audit dump.`,
  },
]

const finderPrompt = (d) => `${SHARED}

=== DIMENSION TO AUDIT: ${d.title} ===

SCOPE & WHERE TO LOOK:
${d.scope}

Audit ONLY this dimension. Return your structured findings (summary, strengths, findings[]).`

const verifyPrompt = (dimTitle, f) => `You are an ADVERSARIAL verifier (red team) for an infrastructure audit of the "kds" multi-tenant restaurant SaaS (NestJS + Prisma + PostgreSQL/PostGIS + Redis + Next.js + Docker + nginx). Repo root: ${ROOT}. Your DEFAULT stance is skepticism: assume the finding is wrong, overstated, or already mitigated elsewhere until the actual code proves otherwise.

A finder in dimension "${dimTitle}" reported:
- TITLE: ${f.title}
- CLAIMED SEVERITY: ${f.severity}
- EVIDENCE: ${f.evidence}
- WHY IT MATTERS: ${f.why_it_matters}
- RECOMMENDATION: ${f.recommendation}

Independently OPEN the cited files (and anywhere a mitigation could plausibly live — config/ConfigModule, a guard, nginx conf, compose, env validation, a default value, another module) and decide:
1. Is the technical claim actually TRUE on the current main branch? Check the real lines.
2. Is there a mitigation elsewhere that the finder missed?
3. Is the severity justified for a REAL-USER PRODUCTION context, or over/under-stated?

Return: verdict (confirmed = real and severity ~right; partly = real but overstated or needs nuance; already_mitigated = handled elsewhere, say where; refuted = factually wrong), corrected_severity, reasoning, and evidence_checked (the files/lines you actually opened).`

// ---- Phase 1+2: per-dimension finder -> adversarial verify of its high-sev findings (pipelined, no barrier) ----
phase('Audit')
log(`Auditing ${DIMENSIONS.length} infrastructure dimensions in parallel, verifying high-severity findings as each completes...`)

const HIGH = ['blocker', 'critical', 'high']

const results = await pipeline(
  DIMENSIONS,
  (d) => agent(finderPrompt(d), { label: `audit:${d.key}`, phase: 'Audit', schema: FINDINGS_SCHEMA }),
  (finder, d) => {
    if (!finder) return { dimension: d.title, key: d.key, finder: null, verifications: [] }
    const toVerify = (finder.findings || []).filter((f) => HIGH.includes(f.severity))
    return parallel(
      toVerify.map((f) => () =>
        agent(verifyPrompt(d.title, f), { label: `verify:${d.key}`, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high' })
          .then((v) => ({ finding: f, verdict: v }))
      )
    ).then((verifications) => ({ dimension: d.title, key: d.key, finder, verifications: verifications.filter(Boolean) }))
  }
)

// ---- Assemble verified dataset ----
const dataset = results.filter(Boolean).map((r) => ({
  dimension: r.dimension,
  key: r.key,
  summary: r.finder ? r.finder.summary : '(audit agent failed to return)',
  strengths: r.finder ? r.finder.strengths || [] : [],
  findings: (r.finder ? r.finder.findings || [] : []).map((f) => {
    const v = (r.verifications || []).find((x) => x.finding && x.finding.title === f.title)
    return {
      title: f.title,
      original_severity: f.severity,
      severity: v && v.verdict ? v.verdict.corrected_severity : f.severity,
      verdict: v && v.verdict ? v.verdict.verdict : 'not_verified',
      verify_reasoning: v && v.verdict ? v.verdict.reasoning : null,
      area: f.area || '',
      evidence: f.evidence,
      why_it_matters: f.why_it_matters,
      recommendation: f.recommendation,
      effort: f.effort,
      confidence: f.confidence,
    }
  }),
}))

// quick stats
const allFindings = dataset.flatMap((d) => d.findings)
const survive = (f) => f.verdict === 'confirmed' || f.verdict === 'partly' || f.verdict === 'not_verified'
const blockers = allFindings.filter((f) => f.severity === 'blocker' && survive(f))
const criticals = allFindings.filter((f) => f.severity === 'critical' && survive(f))
const refuted = allFindings.filter((f) => f.verdict === 'refuted')
const mitigated = allFindings.filter((f) => f.verdict === 'already_mitigated')
log(`Findings: ${allFindings.length} total | ${blockers.length} blocker | ${criticals.length} critical | ${refuted.length} refuted | ${mitigated.length} already-mitigated. Synthesizing...`)

// ---- Phase 3: synthesis ----
phase('Synthesize')
const report = await agent(
  `You are the lead platform / SRE engineer writing the PRODUCTION-READINESS INFRASTRUCTURE REPORT for "kds" (HummyTummy) — a multi-tenant restaurant SaaS (NestJS+Prisma+PostgreSQL/PostGIS+Redis+Next.js+Docker+nginx, GHCR tag->deploy CI, on-prem device mesh) that is ALREADY in production and about to onboard REAL PAYING TENANTS at growing scale.

Below is the raw, adversarially-verified output of a 16-dimension infrastructure audit. Each dimension has a summary, strengths, and findings; each blocker/critical/high finding has an adversarial verdict (confirmed / partly / already_mitigated / refuted) and a corrected_severity.

RAW AUDIT DATA (JSON):
${JSON.stringify(dataset, null, 2)}

Write a sharp, decision-ready report in TURKISH (keep technical terms, file paths, and identifiers in their original form; code/paths stay verbatim). Rules:
- DROP findings whose verdict is "refuted". For "already_mitigated", do NOT list as a problem — instead, where notable, credit it under what's solid. Use the corrected_severity, not the original.
- DEDUPLICATE issues that surfaced in multiple dimensions (e.g. the advisory-lock leak may appear under both DB and jobs; in-memory throttle/cache may appear under ratelimit, redis and scaling) — merge them into one entry and note the cross-cutting nature.
- Be concrete: every blocker/critical entry must carry its evidence (file:line), the real-user/production impact, the fix, and a rough effort.
- Rank ruthlessly for the actual question: "is this safe to put real paying tenants on, and what breaks first as it scales?"

Structure (use these headings):
1. **Yönetici özeti** — one-paragraph verdict + a count line (kaç blocker / critical / high) and the single biggest risk.
2. **Şu an sağlam olanlar** — genuine strengths to NOT regress (brief bullets).
3. **🔴 GO-LIVE BLOCKERS** — must fix before onboarding real tenants. Each: başlık, kanıt (file:line), etki, çözüm, efor.
4. **🟠 İlk haftalar / ölçeklenmeden önce (critical/high)** — what breaks first under real load / a second replica / the first incident.
5. **🟡 Orta öncelik** — should-fix, grouped tightly.
6. **⚪ Hardening backlog** — low/info, one-liners.
7. **Önerilen aksiyon planı** — an ordered, pragmatic sequence (what to do this week vs before scaling vs ongoing), accounting for effort and dependencies between fixes.

Make it the kind of report an engineer can act on immediately. Output ONLY the markdown report.`,
  { label: 'synthesize', phase: 'Synthesize', effort: 'max' }
)

return {
  report,
  stats: {
    dimensions: dataset.length,
    totalFindings: allFindings.length,
    blockers: blockers.length,
    criticals: criticals.length,
    refuted: refuted.length,
    alreadyMitigated: mitigated.length,
  },
  dataset,
}
