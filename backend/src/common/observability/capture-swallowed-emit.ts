import { Logger } from "@nestjs/common";
import { captureException } from "../../sentry.config";

/**
 * A `.catch` handler for best-effort domain-event emits — `outbox.append(...)`,
 * invalidation-bus publishes, gateway broadcasts — that must never break the
 * originating operation, but must NOT vanish silently either.
 *
 * Before this, dozens of `.catch(() => undefined)` sites dropped event-publish
 * failures with no log, no Sentry, no signal — so a dropped
 * `payment.refund_completed.v1` or a missed entitlement reprojection was
 * undiscoverable until a customer complained. This handler keeps the emit
 * best-effort (it still swallows so the caller proceeds) but logs at warn and
 * captures to Sentry with the request-scoped correlation id auto-attached.
 *
 *   await this.outbox
 *     .append({ ... })
 *     .catch(captureSwallowedEmit(this.logger, { module: "payments-core", op: "refund" }));
 */
export function captureSwallowedEmit(
  logger: Logger,
  context: Record<string, unknown>,
): (error: unknown) => void {
  return (error: unknown) => {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.warn(
      `swallowed emit failure [${String(context.module ?? "?")}/${String(
        context.op ?? "?",
      )}]: ${err.message}`,
    );
    captureException(err, context);
  };
}
