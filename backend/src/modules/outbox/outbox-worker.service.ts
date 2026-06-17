import {
  Injectable,
  Logger,
  Optional,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { DomainEventBus } from "./domain-event-bus.service";
import { MarketingEventRelayService } from "./marketing-event-relay.service";
import { MetricsService } from "../../common/metrics/metrics.service";

/**
 * Drains queued OutboxEvent rows onto the in-process DomainEventBus.
 *
 * Single-process implementation: a poll loop wakes every BASE_POLL_MS,
 * claims a batch of rows by flipping status='queued' → 'dispatching' inside
 * a transaction (with row-level locking via Postgres FOR UPDATE SKIP LOCKED
 * so multiple replicas would coordinate safely once we scale out), then
 * dispatches each onto the bus and flips to 'dispatched'. Failed dispatches
 * bump `attempts` with exponential backoff and surface in `lastError`.
 *
 * The polling is intentional rather than triggered by NOTIFY: it's robust
 * under crashes and replica restarts, has bounded recovery time, and trivial
 * to reason about. NOTIFY-driven fast path can be layered on later.
 */
@Injectable()
export class OutboxWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorkerService.name);
  private readonly BASE_POLL_MS = 500;
  private readonly BATCH = 50;
  private readonly MAX_ATTEMPTS = 8;
  // Retention: how long dispatched (success) rows stay around before the
  // pruner deletes them. Configurable via env so ops can extend the
  // forensic window without a deploy. Failed rows are NEVER auto-pruned
  // — they're the DLQ; operator must triage manually.
  private readonly RETENTION_DAYS = Number(
    process.env.OUTBOX_RETENTION_DAYS ?? "14",
  );
  private readonly PRUNE_INTERVAL_MS = 60 * 60_000; // every hour
  // Cap deletions per batch so a backlog doesn't lock the table.
  private readonly PRUNE_BATCH = 5_000;
  // How long a marketing-bound row sleeps when MARKETING_SERVICE_URL is
  // unset ("parked"). Long enough not to spam the local bus with
  // re-dispatches, short enough that configuring the URL drains the
  // backlog within half an hour.
  private readonly UNCONFIGURED_PARK_MS = 30 * 60_000;
  // deep-review H16 — how long a row may sit in 'dispatching' before we
  // treat it as orphaned (worker crashed/OOM/SIGKILL between claiming the
  // batch and writing the terminal status) and reclaim it to 'queued'.
  // Comfortably above the worst-case single-dispatch + marketing-relay HTTP
  // latency so we never race a still-live in-flight dispatch. Re-dispatch is
  // safe: consumers dedupe on idempotencyKey (documented at-least-once
  // contract). The claim already burned an attempt, so a reclaimed crash
  // counts as one attempt — poison pills still converge on the DLQ.
  private readonly STUCK_TIMEOUT_MS = 5 * 60_000;

  private timer: NodeJS.Timeout | null = null;
  private pruneTimer: NodeJS.Timeout | null = null;
  private running = false;
  private pruning = false;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: DomainEventBus,
    private readonly marketingRelay: MarketingEventRelayService,
    // Optional so unit tests that construct the worker bare keep working and
    // the reliability path never depends on the metrics registry being wired.
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  onModuleInit(): void {
    // v2.8.97 — warn at boot if retention is too short. The webhook
    // delivery worker uses exponential backoff capped at 6h between
    // retries; retention below the worst-case retry envelope risks
    // pruning a row whose downstream delivery is still legitimately
    // queued. Recommended floor: 7 days (matches the per-row max
    // attempts × backoff cap). Warn but don't refuse to boot so a
    // deliberately-aggressive prune (e.g. cost-pressed staging) is
    // still possible.
    if (this.RETENTION_DAYS < 7 && this.RETENTION_DAYS >= 1) {
      this.logger.warn(
        `OUTBOX_RETENTION_DAYS=${this.RETENTION_DAYS} is below the recommended 7-day floor. ` +
          `Webhook delivery backoff caps at 6h between retries; rows pruned before delivery completes are silently lost. ` +
          `Raise the env to 7+ unless you've manually verified the delivery worker drains the outbox faster than your retention window.`,
      );
    }
    this.scheduleNext(0);
    // First prune fires shortly after boot so a stale ops dashboard
    // shows a fresh count immediately; subsequent runs are hourly.
    this.schedulePrune(60_000);
  }

  onModuleDestroy(): void {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.pruneTimer) clearTimeout(this.pruneTimer);
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => this.tick().catch(() => undefined), delayMs);
  }

  private schedulePrune(delayMs: number): void {
    if (this.stopping) return;
    this.pruneTimer = setTimeout(() => {
      this.pruneOnce()
        .catch((e) =>
          this.logger.warn(`outbox prune failed: ${(e as Error).message}`),
        )
        .finally(() => this.schedulePrune(this.PRUNE_INTERVAL_MS));
    }, delayMs);
  }

  /**
   * Delete dispatched rows older than RETENTION_DAYS. Bounded batch keeps
   * the lock window short; if a backlog exists the next hourly run picks
   * up the rest. Failed rows are excluded by design — they're the DLQ
   * and need operator triage via the SuperadminOutboxController.
   */
  private async pruneOnce(): Promise<void> {
    if (this.pruning) return;
    if (this.RETENTION_DAYS < 1) return; // safety: never delete on bad config
    this.pruning = true;
    try {
      const cutoff = new Date(
        Date.now() - this.RETENTION_DAYS * 24 * 60 * 60_000,
      );
      const result = await this.prisma.$executeRaw`
        DELETE FROM "outbox_events"
         WHERE "id" IN (
           SELECT "id" FROM "outbox_events"
            WHERE "status" = 'dispatched'
              AND "dispatchedAt" IS NOT NULL
              AND "dispatchedAt" < ${cutoff}
            LIMIT ${this.PRUNE_BATCH}
         )
      `;
      if (result > 0) {
        this.logger.log(
          `outbox prune: removed ${result} dispatched rows older than ${this.RETENTION_DAYS}d`,
        );
      }
      // Re-sync the DLQ-depth gauge to an authoritative count. The inline
      // inc() on each give-up keeps it fresh between prunes; this corrects
      // any drift after an operator requeues or deletes failed rows.
      if (this.metrics) {
        const failed = await this.prisma.outboxEvent.count({
          where: { status: "failed" },
        });
        this.metrics.setOutboxDlqDepth(failed);
      }
    } finally {
      this.pruning = false;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) {
      this.scheduleNext(this.BASE_POLL_MS);
      return;
    }
    this.running = true;
    try {
      // deep-review H16: reclaim orphaned 'dispatching' rows before draining
      // so a crashed-worker's in-flight batch re-enters the queue on the very
      // next poll of whichever replica picks it up. Cheap (indexed status
      // predicate, almost always a no-op) and idempotent across replicas.
      await this.reclaimStuck();
      const drained = await this.drainOnce();
      // If we drained a full batch, immediately try again — backlog catch-up.
      // Otherwise sleep until the next poll cycle.
      this.scheduleNext(drained >= this.BATCH ? 0 : this.BASE_POLL_MS);
    } catch (e) {
      this.logger.error(`outbox tick failed: ${(e as Error).message}`);
      this.scheduleNext(this.BASE_POLL_MS);
    } finally {
      this.running = false;
    }
  }

  /**
   * deep-review H16 — reclaim outbox rows orphaned in status='dispatching'.
   *
   * If the worker process dies (OOM, SIGKILL during a deploy/rollout, pod
   * eviction) after the claim UPDATE flips a batch to 'dispatching' but
   * before each row's terminal write, those rows would otherwise stay
   * 'dispatching' forever: drainOnce() only selects 'queued', pruneOnce()
   * only deletes 'dispatched', and the superadmin requeue only targets
   * 'failed'. The events — including payment.succeeded.v1 (commission
   * crediting) and subscription/entitlement reprojection — would be silently
   * lost. This reaper flips any 'dispatching' row whose claim timestamp
   * (stamped into nextAttemptAt by the claim UPDATE) has aged past
   * STUCK_TIMEOUT_MS back to 'queued'.
   *
   * We deliberately do NOT decrement attempts: the claim already burned one,
   * and counting the crash as an attempt keeps a genuine poison pill (one
   * that reliably kills the worker mid-dispatch) converging on the DLQ
   * instead of looping forever. Re-dispatch is safe under the at-least-once
   * contract — consumers dedupe on idempotencyKey.
   */
  private async reclaimStuck(): Promise<number> {
    const cutoff = new Date(Date.now() - this.STUCK_TIMEOUT_MS);
    const reclaimed = await this.prisma.$executeRaw`
      UPDATE "outbox_events"
         SET "status" = 'queued',
             "nextAttemptAt" = NULL,
             "lastError" = 'reclaimed: stuck in dispatching past timeout (worker likely crashed)'
       WHERE "status" = 'dispatching'
         AND "nextAttemptAt" IS NOT NULL
         AND "nextAttemptAt" < ${cutoff}
    `;
    if (reclaimed > 0) {
      // Loud on purpose: a non-zero reclaim means a worker died mid-dispatch.
      // Ops should correlate with a crash/OOM/eviction around this time.
      this.logger.warn(
        `outbox reclaim: re-queued ${reclaimed} row(s) orphaned in 'dispatching' past ${this.STUCK_TIMEOUT_MS}ms (worker likely crashed)`,
      );
      // deep-review H16: expose reclaims to Prometheus so an alert can fire
      // when this is non-zero (the existing outbox_dlq_depth gauge only ever
      // catches status='failed' and would never have surfaced this state).
      // A counter is used because MetricsService has a generic incCounter but
      // no generic gauge setter; a sustained non-zero rate is the alert
      // signal. (A dedicated `outbox_dispatching_depth` gauge would need a
      // MetricsService change — out of scope for this file; see deviations.)
      this.metrics?.incCounter(
        "outbox_events_reclaimed_total",
        "Outbox events reclaimed from a stuck 'dispatching' state (worker crash recovery)",
      );
    }
    return reclaimed;
  }

  private async drainOnce(): Promise<number> {
    // Claim a batch atomically. Using raw SQL because Prisma can't express
    // FOR UPDATE SKIP LOCKED on the same statement that returns the rows.
    // Postgres syntax: UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP
    // LOCKED LIMIT N) RETURNING *.
    const now = new Date();
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        type: string;
        tenantId: string | null;
        payload: any;
        idempotencyKey: string;
        attempts: number;
        createdAt: Date;
      }>
    >`
      UPDATE "outbox_events"
         SET "status" = 'dispatching',
             "attempts" = "attempts" + 1,
             -- deep-review H16: stamp the claim time onto the row (reusing
             -- nextAttemptAt, the only mutable timestamp column on
             -- OutboxEvent) so reclaimStuck() can detect rows orphaned in
             -- 'dispatching' by a worker crash. A clean terminal write
             -- below overwrites/clears this; a crash leaves it as the claim
             -- instant, and once it ages past STUCK_TIMEOUT_MS the reaper
             -- re-queues the row.
             "nextAttemptAt" = ${now}
       WHERE "id" IN (
         SELECT "id" FROM "outbox_events"
          WHERE "status" = 'queued'
            AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${now})
          ORDER BY "id"
          FOR UPDATE SKIP LOCKED
          LIMIT ${this.BATCH}
       )
       RETURNING "id", "type", "tenantId", "payload", "idempotencyKey", "attempts", "createdAt";
    `;

    for (const r of rows) {
      try {
        await this.bus.dispatch({
          id: r.id,
          type: r.type,
          tenantId: r.tenantId,
          payload: r.payload,
          idempotencyKey: r.idempotencyKey,
          createdAt: r.createdAt,
        });
        // Phase-5 split: marketing-bound events (payment.succeeded.v1,
        // marketing.*) are additionally relayed over HTTP to the
        // kds-marketing service. A failed relay throws into the catch
        // below, re-queueing the row with backoff — i.e. delivery to the
        // marketing service is retried by the same outbox machinery as the
        // in-process dispatch. Bus listeners are idempotent by contract,
        // so re-observing the event on a relay retry is safe.
        const relayResult = await this.marketingRelay.relay(r);
        if (relayResult === "skipped-unconfigured") {
          // MARKETING_SERVICE_URL is unset but this event is marketing-bound.
          // PARK the row instead of marking it dispatched: keep it pending
          // with a long nextAttemptAt and hand back the attempt the claim
          // burned, so it can never DLQ from this path and the eventual
          // configuration of the URL backfills the backlog. The local bus
          // re-dispatch on each park cycle is the documented at-least-once
          // contract — listeners dedupe (e.g. the webhook fan-out's unique
          // constraint on (eventId, endpointId)).
          await this.prisma.outboxEvent.update({
            where: { id: r.id },
            data: {
              status: "queued",
              attempts: r.attempts - 1,
              nextAttemptAt: new Date(Date.now() + this.UNCONFIGURED_PARK_MS),
              lastError:
                "parked: MARKETING_SERVICE_URL is not configured — marketing-bound event held pending until the relay is enabled",
            },
          });
          continue;
        }
        await this.prisma.outboxEvent.update({
          where: { id: r.id },
          data: {
            status: "dispatched",
            dispatchedAt: new Date(),
            lastError: null,
          },
        });
        this.metrics?.incCounter(
          "outbox_events_processed_total",
          "Outbox events processed, labeled by terminal result",
          { result: "dispatched" },
        );
      } catch (e) {
        const msg = (e as Error).message?.slice(0, 500) ?? "unknown";
        const final = r.attempts >= this.MAX_ATTEMPTS;
        // Backoff: 0.5s, 1s, 2s, 4s, ... capped at 5min.
        const backoffMs = Math.min(500 * 2 ** r.attempts, 5 * 60_000);
        await this.prisma.outboxEvent.update({
          where: { id: r.id },
          data: {
            status: final ? "failed" : "queued",
            lastError: msg,
            nextAttemptAt: final ? null : new Date(Date.now() + backoffMs),
          },
        });
        if (final) {
          // DLQ wording is intentional: ops alert rules grep on
          // "outbox DLQ" to wake someone up. Once an event lands here
          // it will not be retried automatically — operator must
          // requeue via SuperadminOutboxController or delete it.
          this.logger.error(
            `outbox DLQ: event ${r.id} (${r.type}) gave up after ${r.attempts} attempts — ${msg}`,
          );
          this.metrics?.incOutboxDlqDepth();
          this.metrics?.incCounter(
            "outbox_events_processed_total",
            "Outbox events processed, labeled by terminal result",
            { result: "failed" },
          );
        } else {
          this.logger.warn(
            `outbox event ${r.id} (${r.type}) will retry after ${r.attempts} attempts: ${msg}`,
          );
        }
      }
    }
    return rows.length;
  }
}
