import { Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

export interface AdvisoryLockOptions {
  /**
   * Hard ceiling for how long the lock-holding transaction may stay open
   * (ms). The job body runs INSIDE this transaction, so this also bounds
   * the job's runtime: if `run()` exceeds it, Prisma rolls the transaction
   * back (releasing the lock) and the call rejects — the job just retries
   * on the next tick instead of wedging a connection forever. Default
   * 15 min; override per-job for unusually long sweeps.
   */
  timeoutMs?: number;
  /** Max time to wait for a free pooled connection before failing (ms). */
  maxWaitMs?: number;
}

const DEFAULT_TIMEOUT_MS = (() => {
  const raw = Number(process.env.ADVISORY_LOCK_TX_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 15 * 60 * 1000;
})();

/**
 * Postgres advisory-lock wrapper for cross-replica cron leader election,
 * so every cron in the codebase uses the same coordination scheme.
 *
 * Under multi-replica deploy, every replica fires its @Cron decorators on
 * the same wall-clock tick — without coordination they all do duplicate
 * work (and in some cases double-charge / double-emit / double-update).
 * The winning replica acquires the lock and runs the body; the losers
 * silently skip.
 *
 * IMPLEMENTATION — why a transaction:
 * We take a **transaction-scoped** lock (`pg_try_advisory_xact_lock`) inside
 * a single interactive `$transaction`, NOT a session-scoped one. The old
 * implementation paired `pg_try_advisory_lock` (acquire) with a separate
 * `pg_advisory_unlock` (release) issued as two independent
 * `prisma.$queryRawUnsafe` calls — which Prisma routes over the connection
 * pool. Under any pool with >1 connection, the unlock frequently landed on
 * a DIFFERENT connection than the one that acquired the lock, so it was a
 * no-op: the lock stayed held on the acquiring connection (a session that,
 * with a long-lived pool, never ends). Every later tick then saw the lock
 * "held by another replica" and skipped — silently wedging the job (billing
 * sweeps, webhook delivery, z-reports, …) until a process restart. This
 * happened on a SINGLE replica too.
 *
 * `pg_try_advisory_xact_lock` is non-blocking (returns true/false at once)
 * and is released AUTOMATICALLY by Postgres on COMMIT/ROLLBACK — on the
 * exact connection that took it. No manual unlock, no cross-connection
 * footgun. The lock is held for the duration of `run()` (the body is
 * awaited inside the transaction), which is the intended leader-election
 * window.
 *
 * NOTE (infra dependency): the lock-holding transaction's connection is
 * idle-in-transaction while `run()` does its work on other pooled
 * connections. Do NOT set a short server-side
 * `idle_in_transaction_session_timeout` or it will kill the leader mid-job
 * and let another replica grab the lock. The runtime statement_timeout
 * (see PrismaService) is fine — it does not count idle time. The Prisma
 * transaction `timeout` above is the deliberate upper bound.
 *
 * The id is derived from the job name with DJB2 (stable across runs), so
 * the same job string yields the same lock across replicas. The
 * transaction-scoped and (legacy) session-scoped variants share the same
 * 64-bit advisory lock space keyed by this id, so a rolling deploy that
 * mixes old and new replicas still mutually excludes correctly.
 */
export async function withAdvisoryLock(
  prisma: PrismaService,
  jobName: string,
  run: () => Promise<void>,
  logger?: Logger,
  options?: AdvisoryLockOptions,
): Promise<void> {
  const lockId = djb2(jobName);
  await prisma.$transaction(
    async (tx) => {
      const acquired = await tx.$queryRawUnsafe<{ locked: boolean }[]>(
        `SELECT pg_try_advisory_xact_lock(${lockId}) AS locked`,
      );
      if (!acquired[0]?.locked) {
        logger?.debug(`skip ${jobName}: advisory lock held by another replica`);
        return;
      }
      await run();
      // No explicit unlock — the xact-scoped lock is released by Postgres
      // when this transaction commits (or rolls back, if run() throws).
    },
    {
      timeout: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxWait: options?.maxWaitMs ?? 5000,
    },
  );
}

/** Deterministic 32-bit hash. Stable for the same input across processes. */
function djb2(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i += 1) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
  }
  return hash;
}
