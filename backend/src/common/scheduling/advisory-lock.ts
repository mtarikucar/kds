import { Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * Postgres advisory-lock wrapper, factored out of SubscriptionSchedulerService
 * so every new cron in the codebase uses the same coordination scheme.
 *
 * Under multi-replica deploy, every replica fires its @Cron decorators on
 * the same wall-clock tick — without coordination they all do duplicate
 * work (and in some cases double-charge / double-emit / double-update).
 * The winning replica proceeds, the losers silently skip.
 *
 * MECHANISM (v2 — leak-proof): a single interactive transaction acquires
 * `pg_try_advisory_xact_lock` and holds it while `run()` executes; the lock
 * releases automatically at commit/rollback. The previous implementation
 * issued try_lock and unlock as two SEPARATE pooled queries — advisory
 * SESSION locks belong to the connection that took them, so whenever the
 * pool handed the unlock to a different connection it was a silent no-op,
 * the lock stayed held by an idle pooled session ~forever, and every later
 * tick of that job saw locked=false → the cron silently stalled until that
 * one connection happened to close. The xact variant cannot leak: there is
 * no unlock call to route to the wrong session, and a crashed process
 * releases at rollback.
 *
 * The transaction performs no reads/writes itself — it is purely the lock
 * holder (run()'s own queries use the normal pooled client), so it pins one
 * pool connection (idle-in-transaction) for the duration of the job. The
 * timeout is a safety valve for a wedged job; it is deliberately generous
 * because expiry RELEASES the lock while an in-flight run() keeps executing
 * detached — i.e. the very duplicate-run the lock exists to prevent.
 *
 * The id is derived from the job name with DJB2 (stable across runs), so
 * the same job string yields the same lock across replicas. Lock collisions
 * across different jobs are mathematically possible but harmless — the loser
 * just retries next tick. The 32-bit hash space gives ~4B distinct slots.
 */
export async function withAdvisoryLock(
  prisma: PrismaService,
  jobName: string,
  run: () => Promise<void>,
  logger?: Logger,
  opts?: { timeoutMs?: number; maxWaitMs?: number },
): Promise<void> {
  const lockId = djb2(jobName);
  await prisma.$transaction(
    async (tx) => {
      const acquired = await tx.$queryRawUnsafe<{ locked: boolean }[]>(
        `SELECT pg_try_advisory_xact_lock(${lockId}) AS locked`,
      );
      if (!acquired?.[0]?.locked) {
        logger?.debug(`skip ${jobName}: advisory lock held by another replica`);
        return;
      }
      await run();
    },
    {
      maxWait: opts?.maxWaitMs ?? 10_000,
      timeout: opts?.timeoutMs ?? 30 * 60_000,
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
