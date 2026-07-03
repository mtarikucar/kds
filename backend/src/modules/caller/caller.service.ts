import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { v7 as uuidv7 } from "uuid";
import { PrismaService } from "../../prisma/prisma.service";
import { OutboxService } from "../outbox/outbox.service";
import { NormalisedCallerEvent } from "./caller-provider.interface";

/**
 * Caller / phone-order ingest. The flow:
 *
 *   provider webhook → adapter.parseWebhook() → NormalisedCallerEvent[] →
 *   caller.service.ingest() → caller_events row + outbox event →
 *   downstream consumers (UI presence channel, customer matcher) react.
 *
 * Customer matching is best-effort: an exact e164 hit links the row, but the
 * lack of a match never blocks ingestion (you still want to see the call).
 *
 * NOTE (fake-working sweep #3): CallerEvent.orderId / CallerEvent.agentUserId
 * exist in the schema as future-facing columns but NO application code writes
 * them today — there is no call→order back-link path and the
 * NormalisedCallerEvent adapter contract carries neither field. The Caller
 * feed UI previously advertised an "Order" column + agent attribution that
 * always rendered "—"; that dead UI was removed rather than left implying a
 * working linkage. If/when phone-order creation back-links a call, set
 * orderId/agentUserId here (or via a callerEvent.update at order-create time)
 * and restore the column.
 */
@Injectable()
export class CallerService {
  private readonly logger = new Logger(CallerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async ingest(tenantId: string, event: NormalisedCallerEvent) {
    // CallerEvent.tenantId has no FK in the schema (denormalised for write
    // throughput), so a malformed/unknown tenantId from the public webhook
    // route would otherwise land a noise row that the UI feed renders.
    // Validate before the create so attackers can't seed arbitrary tenants.
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) {
      throw new NotFoundException("Unknown tenant");
    }

    // Try a customer match by e164. Keeps the column denormalised so the UI
    // can render "returning customer" without a join.
    let customerId: string | null = null;
    if (event.e164) {
      const c = await this.prisma.customer.findFirst({
        where: { tenantId, phone: event.e164 },
        select: { id: true },
      });
      customerId = c?.id ?? null;
    }

    // Replay/dedup is authoritative at the DB level: a UNIQUE index on
    // (tenantId, providerId, callId, kind) means a provider re-delivering the
    // same callback (at-least-once webhooks are the norm) collides on P2002.
    // We treat that as an idempotent no-op — the first delivery already
    // created the row and emitted the outbox event, so re-emitting would
    // double-fire downstream consumers (UI popup, customer matcher).
    // Coerce + validate the provider-supplied timestamp before it reaches
    // Prisma. A malformed occurredAt would make `new Date(...)` an Invalid Date
    // and the create throw a NON-P2002 error → 500 → the caller-webhook's
    // at-least-once retry storms and wedges the rest of the batch. Fall back to
    // "now" (the call is arriving ~now) so one bad field can't poison ingest.
    const parsedOccurredAt = new Date(event.occurredAt);
    const occurredAt = Number.isNaN(parsedOccurredAt.getTime())
      ? new Date()
      : parsedOccurredAt;

    const eventType =
      event.kind === "incoming"
        ? "caller.incoming.v1"
        : event.kind === "answered"
          ? "caller.answered.v1"
          : event.kind === "ended"
            ? "caller.ended.v1"
            : "caller.missed.v1";

    let row;
    try {
      // Create the row AND append the outbox event in ONE transaction (tx-aware
      // append). Pre-fix the append ran as a separate `.append().catch()` after
      // the create committed, so an append failure LOST the real-time call
      // popup forever: the row persisted, and the provider's at-least-once retry
      // hit the P2002 dedup below → returned null → never re-emitted. Emitting
      // inside the tx means an append failure rolls the row back too, so the
      // retry re-creates BOTH and the popup is delivered.
      row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.callerEvent.create({
          data: {
            id: uuidv7(),
            tenantId,
            providerId: event.providerId,
            callId: event.callId,
            kind: event.kind,
            e164: event.e164,
            customerId,
            durationMs: event.durationMs,
            meta: event.meta as any,
            occurredAt,
          },
        });
        await this.outbox.append(
          {
            type: eventType,
            tenantId,
            payload: {
              callerEventId: created.id,
              providerId: event.providerId,
              callId: event.callId,
              e164: event.e164,
              customerId,
            },
          },
          tx,
        );
        return created;
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        this.logger.debug(
          `caller dedup: ignoring replay (${tenantId}/${event.providerId}/${event.callId}/${event.kind})`,
        );
        return null;
      }
      throw err;
    }

    return row;
  }

  listRecent(tenantId: string, limit = 50) {
    return this.prisma.callerEvent.findMany({
      where: { tenantId },
      orderBy: { occurredAt: "desc" },
      take: Math.min(limit, 500),
    });
  }
}
