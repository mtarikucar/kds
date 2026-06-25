import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * Append a runtime `statement_timeout` to the application's DATABASE_URL.
 *
 * Without a ceiling, one runaway/blocked query holds its pooled connection
 * for as long as it runs; a handful of those exhaust the small Prisma pool
 * and cascade into request failures for unrelated tenants — the classic
 * shared-pool noisy-neighbor outage. A server-side statement_timeout is the
 * targeted fix, but setting it on the POSTGRES SERVER would also bite
 * `prisma migrate deploy` (a non-CONCURRENT CREATE INDEX) and `pg_dump`
 * (a multi-GB backup COPY) — both legitimately long. Those run as their own
 * CLI sessions and never instantiate PrismaService, so scoping the timeout
 * to the URL THIS client opens leaves migrations and backups untouched.
 *
 * Implementation notes:
 *  - We hand-encode `options=-c statement_timeout=<ms>` (%20 for the space,
 *    %3D for the '='). URLSearchParams would serialize the space as '+',
 *    which libpq does NOT decode back to a space inside a connection URI →
 *    a broken option string. So we append manually.
 *  - statement_timeout caps a single statement's *execution* time; it does
 *    NOT count idle-in-transaction time. The advisory-lock leader
 *    transaction (see withAdvisoryLock) idles while the job body runs on
 *    other connections, so this timeout is safe for it. We deliberately do
 *    NOT set idle_in_transaction_session_timeout — that WOULD kill the
 *    leader mid-job and break cross-replica cron coordination.
 *  - Set DB_STATEMENT_TIMEOUT_MS=0 to disable; respects an operator-supplied
 *    `options` string already on the URL (won't clobber).
 */
export function buildRuntimeDatabaseUrl(
  raw: string | undefined,
  timeoutMsRaw: string | undefined,
): string | undefined {
  if (!raw) return raw;
  const parsed = Number(timeoutMsRaw);
  const timeoutMs = Number.isFinite(parsed) ? parsed : 60_000;
  if (timeoutMs <= 0) return raw; // explicitly disabled
  if (/[?&]options=/.test(raw)) return raw; // operator already set options
  const encoded = `options=-c%20statement_timeout%3D${timeoutMs}`;
  const sep = raw.includes("?") ? "&" : "?";
  return `${raw}${sep}${encoded}`;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    // v2.8.97 — query log is gated on an EXPLICIT env flag rather than
    // `NODE_ENV === 'development'`. Prisma's `query` log level emits
    // bound parameters alongside the SQL — password hashes, refresh
    // tokens, OTP codes, encrypted credentials all flow through Prisma
    // verbatim. Pre-fix a staging env with NODE_ENV=development (a
    // common misconfig when copying .env.example) would have streamed
    // every secret into the application logs. The new flag
    // PRISMA_LOG_QUERIES=true is opt-in; production refuses to honor
    // it even if set.
    const enableQueryLogs =
      process.env.PRISMA_LOG_QUERIES === "true" &&
      process.env.NODE_ENV !== "production";
    super({
      datasources: {
        db: {
          url: buildRuntimeDatabaseUrl(
            process.env.DATABASE_URL,
            process.env.DB_STATEMENT_TIMEOUT_MS,
          ),
        },
      },
      log: enableQueryLogs ? ["query", "error", "warn"] : ["error", "warn"],
    });
  }

  async onModuleInit() {
    await this.$connect();
    console.log("✅ Database connected");
    // Surface the effective statement_timeout so a silently-ignored
    // connection option is visible in boot logs rather than a no-op.
    try {
      const rows = await this.$queryRawUnsafe<{ statement_timeout: string }[]>(
        "SHOW statement_timeout",
      );
      const effective = rows?.[0]?.statement_timeout ?? "unknown";
      const intended = process.env.DB_STATEMENT_TIMEOUT_MS;
      if (
        effective === "0" &&
        intended !== undefined &&
        intended !== "0" &&
        intended !== ""
      ) {
        console.warn(
          `⚠️  statement_timeout is 0 despite DB_STATEMENT_TIMEOUT_MS=${intended} — the connection 'options' may have been ignored; verify DATABASE_URL.`,
        );
      } else {
        console.log(`⏱️  statement_timeout = ${effective}`);
      }
    } catch {
      // Non-fatal: never block boot on the diagnostic probe.
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    console.log("🔌 Database disconnected");
  }

  async cleanDatabase() {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Cannot clean database in production");
    }

    const models = Reflect.ownKeys(this).filter((key) => key[0] !== "_");

    return Promise.all(models.map((modelKey) => this[modelKey].deleteMany()));
  }
}
