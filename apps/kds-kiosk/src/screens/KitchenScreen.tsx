import { useEffect, useRef, useState } from 'react';
import { ackCommand, claimNextCommand, heartbeat } from '../api/mesh';
import type { DeviceToken } from '../store/deviceToken';

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
interface OrderTicket {
  orderId: string;
  shownAt: number;
  // Free-form payload — the cloud sends order metadata here.
  meta?: Record<string, unknown>;
}

export default function KitchenScreen({ token, onLogout }: { token: DeviceToken; onLogout: () => void }) {
  const [tickets, setTickets] = useState<OrderTicket[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const ticketsRef = useRef(tickets);
  ticketsRef.current = tickets;

  useEffect(() => {
    let stop = false;

    async function loop() {
      try {
        const cmd = await claimNextCommand(token);
        if (!cmd) return;
        const orderId = (cmd.payload?.orderId as string | undefined) ?? '';
        if (cmd.kind === 'show_order' && orderId) {
          // Skip duplicates — the cloud may resend the same command on
          // network blips; the dedup keeps the screen stable.
          if (!ticketsRef.current.find((t) => t.orderId === orderId)) {
            setTickets((prev) => [
              ...prev,
              { orderId, shownAt: Date.now(), meta: cmd.payload },
            ]);
          }
        } else if (cmd.kind === 'clear_order' && orderId) {
          setTickets((prev) => prev.filter((t) => t.orderId !== orderId));
        }
        await ackCommand(token, cmd.id, { status: 'done', result: {} });
      } catch (e: any) {
        setLastError(e?.message ?? 'poll failed');
      }
    }

    const pollHandle = setInterval(() => {
      if (!stop) void loop();
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
                <span style={styles.age}>{ageOf(t.shownAt)}</span>
              </header>
              <pre style={styles.payload}>{JSON.stringify(t.meta ?? {}, null, 2).slice(0, 600)}</pre>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}

function ageOf(shownAt: number): string {
  const sec = Math.floor((Date.now() - shownAt) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h`;
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
