import { useEffect, useRef, useState } from 'react';
import { ackCommand, claimNextCommand, DeviceAuthError, heartbeat, type DeviceCommand } from '../api/mesh';
import type { DeviceToken } from '../store/deviceToken';
import { ageOf, applyCommand, type OrderTicket } from './kitchenLogic';

/**
 * Whether this build can meaningfully execute a command. Mirrors the kinds
 * applyCommand actually acts on, plus the shared-bus 'noop'. Anything else
 * (a future print/fiscal kind, a typo'd kind, or show/clear without an
 * orderId) is NOT handled and must be acked 'failed' rather than silently
 * acked 'done' — otherwise the cloud marks it complete and never retries.
 * deep-review NM4. (Prescribed fix lives in kitchenLogic.applyCommand, which
 * is out of scope for this cluster; computed here once, outside the setTickets
 * updater, so applyCommand stays pure and is called exactly once.)
 */
function isHandledCommand(cmd: DeviceCommand): boolean {
  const orderId = (cmd.payload?.orderId as string | undefined) ?? '';
  if (cmd.kind === 'show_order' || cmd.kind === 'clear_order') return orderId !== '';
  if (cmd.kind === 'noop') return true;
  return false;
}

/**
 * Main kitchen view.
 *
 * Two background loops, both `setInterval`-driven so the React render
 * tree doesn't have to think about scheduling:
 *   - heartbeat every 20s: keeps the cloud's lastSeenAt fresh
 *   - poll every 2s for next command: claims show_order / clear_order
 *
 * Order state is held in-memory only. A kiosk restart loses it — that's
 * fine because every active order is re-fetched on the next show_order
 * command (the cloud re-sends each on reconnect).
 */
export default function KitchenScreen({ token, onLogout }: { token: DeviceToken; onLogout: () => void }) {
  const [tickets, setTickets] = useState<OrderTicket[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const ticketsRef = useRef(tickets);
  ticketsRef.current = tickets;

  useEffect(() => {
    let stop = false;
    // deep-review NH8: PairOut tokens are time-bounded (expiresAt). If the
    // persisted token is already expired (with a small clock-skew margin),
    // re-pair immediately rather than burning a round-trip on a guaranteed 401.
    const SKEW_MS = 30_000;
    function expiredNow(): boolean {
      const exp = Date.parse(token.expiresAt);
      return Number.isFinite(exp) && exp - SKEW_MS <= Date.now();
    }
    if (expiredNow()) {
      setLastError('Session expired — re-pair this device');
      onLogout();
      return;
    }
    // Guard against overlapping iterations. ESC/POS prints can take 3-5s;
    // without this flag the 2s setInterval would re-enter loop() before
    // the previous ack completes, claim the same command in the new race,
    // and print the same ticket twice. Per-effect scope so a token
    // change resets it via cleanup.
    let inFlight = false;
    // Exponential skip after errors so a wedged cloud doesn't get
    // hammered every 2s. Resets on the first clean iteration.
    let consecutiveErrors = 0;

    async function loop() {
      if (inFlight || stop) return;
      // deep-review NH8: proactively re-pair once the token crosses expiry,
      // rather than waiting for the next server 401.
      if (expiredNow()) {
        stop = true;
        setLastError('Session expired — re-pair this device');
        onLogout();
        return;
      }
      inFlight = true;
      try {
        const cmd = await claimNextCommand(token);
        if (stop) return;
        consecutiveErrors = 0;
        if (!cmd) return;
        // Compute handled + next list once, outside the updater, so the result
        // is available to the ack and applyCommand stays pure. deep-review NM4.
        const handled = isHandledCommand(cmd);
        setTickets((prev) => applyCommand(prev, cmd, Date.now()));
        if (stop) return;
        if (handled) {
          await ackCommand(token, cmd.id, { status: 'done', result: {} });
        } else {
          // Unknown / unactionable kind: ack 'failed' so the cloud surfaces it
          // (device.command.failed.v1) instead of recording a silent success.
          // deep-review NM4.
          console.warn(`[kds] unhandled command kind '${cmd.kind}' (id=${cmd.id})`);
          await ackCommand(token, cmd.id, { status: 'failed', error: `unsupported kind: ${cmd.kind}` });
          setLastError(`Ignored unsupported command: ${cmd.kind}`);
        }
      } catch (e: any) {
        if (stop) return;
        // deep-review NH8: a rejected device token is a recoverable, distinct
        // state — drop straight back to pairing instead of throttling forever
        // behind exponential backoff with a frozen ticket list.
        if (e instanceof DeviceAuthError) {
          stop = true;
          setLastError('Session expired — re-pair this device');
          onLogout();
          return;
        }
        consecutiveErrors = Math.min(consecutiveErrors + 1, 6);
        setLastError(e?.message ?? 'poll failed');
      } finally {
        inFlight = false;
      }
    }

    const pollHandle = setInterval(() => {
      if (stop) return;
      // Skip ticks while in flight (covered inside loop() too, but this
      // avoids the wasted call cost). Backoff after errors: skip with
      // probability 1 - 1/2^N so 2 errors ≈ skip 75% of ticks, 6+ errors
      // ≈ skip ~98%. Self-recovering on first successful iteration.
      if (consecutiveErrors > 0 && Math.random() < 1 - 1 / (1 << consecutiveErrors)) return;
      void loop();
    }, 2000);
    const heartbeatHandle = setInterval(() => {
      if (!stop) heartbeat(token, { queueDepth: ticketsRef.current.length }).catch(() => undefined);
    }, 20_000);
    void loop();

    return () => {
      stop = true;
      clearInterval(pollHandle);
      clearInterval(heartbeatHandle);
    };
  }, [token]);

  return (
    <main style={styles.wrap}>
      <header style={styles.header}>
        <div>
          <strong>HummyTummy KDS</strong>
          <span style={styles.deviceId}>{token.deviceId.slice(0, 8)}…</span>
        </div>
        <button onClick={onLogout} style={styles.unpair}>
          Unpair
        </button>
      </header>

      {lastError && (
        <div style={styles.error}>
          {lastError} <button onClick={() => setLastError(null)} style={styles.dismiss}>×</button>
        </div>
      )}

      {tickets.length === 0 ? (
        <div style={styles.idle}>Waiting for orders…</div>
      ) : (
        <div style={styles.grid}>
          {tickets.map((t) => (
            <article key={t.orderId} style={styles.ticket}>
              <header style={styles.ticketHeader}>
                <span style={styles.orderId}>#{t.orderId.slice(-6)}</span>
                <span style={styles.age}>{ageOf(t.shownAt, Date.now())}</span>
              </header>
              <pre style={styles.payload}>{JSON.stringify(t.meta ?? {}, null, 2).slice(0, 600)}</pre>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', height: '100%' },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 20px',
    borderBottom: '1px solid #1f2a44',
    background: '#0f1729',
  },
  deviceId: { marginLeft: 12, opacity: 0.4, fontSize: 12, fontFamily: 'monospace' },
  unpair: { background: 'transparent', color: '#9aa6c0', border: '1px solid #2a3650', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12 },
  error: { background: '#3a1a1a', borderBottom: '1px solid #6b2828', padding: '6px 12px', fontSize: 13, display: 'flex', justifyContent: 'space-between' },
  dismiss: { background: 'transparent', color: 'inherit', border: 'none', cursor: 'pointer', fontSize: 16 },
  idle: { flex: 1, display: 'grid', placeItems: 'center', fontSize: 24, opacity: 0.3 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, padding: 16, overflow: 'auto', flex: 1 },
  ticket: { background: '#162033', border: '1px solid #2a3650', borderRadius: 12, padding: 14 },
  ticketHeader: { display: 'flex', justifyContent: 'space-between', marginBottom: 8 },
  orderId: { fontWeight: 600, fontSize: 18 },
  age: { opacity: 0.5, fontSize: 12, fontFamily: 'monospace' },
  payload: { margin: 0, fontFamily: 'monospace', fontSize: 12, opacity: 0.7, whiteSpace: 'pre-wrap' },
};
