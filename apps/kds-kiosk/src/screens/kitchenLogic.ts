/**
 * Pure logic extracted from KitchenScreen so it can be unit-tested without a
 * React render tree or live timers. The behavior is byte-identical to the
 * inlined originals; KitchenScreen re-imports these and calls them at the
 * same points it used to compute the values inline.
 */
import type { DeviceCommand } from '../api/mesh';

export interface OrderTicket {
  orderId: string;
  shownAt: number;
  // Free-form payload — the cloud sends order metadata here.
  meta?: Record<string, unknown>;
}

/**
 * Human-readable age label for a ticket given the time it was shown.
 *
 * `now` is a parameter (rather than calling Date.now() internally) so the
 * function is deterministic and testable. The call site passes Date.now().
 */
export function ageOf(shownAt: number, now: number): string {
  const sec = Math.floor((now - shownAt) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h`;
}

/**
 * Apply a single mesh command to the current ticket list, returning the next
 * list. Pure reducer extracted from the KitchenScreen poll loop:
 *
 *   - `show_order` with a fresh orderId appends a ticket (stamped with `now`).
 *   - `show_order` for an orderId already present is a no-op (de-dupe).
 *   - `clear_order` removes the ticket with the matching orderId.
 *   - any other kind, or a command with no orderId, leaves the list unchanged.
 *
 * `now` is injected (was Date.now() inline) to keep the reducer deterministic.
 */
export function applyCommand(
  prev: OrderTicket[],
  cmd: DeviceCommand,
  now: number,
): OrderTicket[] {
  const orderId = (cmd.payload?.orderId as string | undefined) ?? '';
  if (cmd.kind === 'show_order' && orderId) {
    if (!prev.find((t) => t.orderId === orderId)) {
      return [...prev, { orderId, shownAt: now, meta: cmd.payload }];
    }
    return prev;
  }
  if (cmd.kind === 'clear_order' && orderId) {
    return prev.filter((t) => t.orderId !== orderId);
  }
  return prev;
}
