import { useState } from 'react';
import { pairDevice } from '../api/mesh';
import type { DeviceToken } from '../store/deviceToken';

/**
 * First-boot screen. The operator scans (or types) the 6-character pair
 * code displayed in the admin UI. The kiosk POSTs to /v1/devices/pair on
 * the configured API URL and stores the returned token in the keyring.
 *
 * API URL is configurable so a venue on a private LAN can point the
 * kiosk at a private deployment without a code change.
 */
export default function PairingScreen({ onPaired }: { onPaired: (token: DeviceToken) => void }) {
  const [apiUrl, setApiUrl] = useState(
    () => localStorage.getItem('kds_api_url') ?? 'https://hummytummy.com/api',
  );
  const [pairCode, setPairCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      // Persist the API URL so a kiosk reboot doesn't lose it.
      localStorage.setItem('kds_api_url', apiUrl);
      const out = await pairDevice(apiUrl, pairCode.trim().toUpperCase());
      onPaired({ ...out, apiUrl });
    } catch (e: any) {
      setError(e?.message ?? 'Pair failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={styles.wrap}>
      <h1 style={styles.title}>HummyTummy KDS</h1>
      <p style={styles.sub}>Enter the pair code from the admin dashboard.</p>

      <form onSubmit={submit} style={styles.form}>
        <label style={styles.label}>
          <span>API URL</span>
          <input
            style={styles.input}
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="https://api.example.com/api"
            spellCheck={false}
          />
        </label>

        <label style={styles.label}>
          <span>Pair code</span>
          <input
            style={{ ...styles.input, fontSize: 36, letterSpacing: 4, textAlign: 'center' }}
            value={pairCode}
            onChange={(e) => setPairCode(e.target.value.toUpperCase())}
            maxLength={6}
            autoFocus
            spellCheck={false}
            placeholder="A4F9K2"
          />
        </label>

        {error && <div style={styles.error}>{error}</div>}

        <button type="submit" disabled={submitting || pairCode.length !== 6} style={styles.button}>
          {submitting ? 'Pairing…' : 'Pair'}
        </button>
      </form>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    padding: 24,
  },
  title: { fontSize: 48, margin: 0, fontWeight: 300 },
  sub: { opacity: 0.6, marginTop: 8, marginBottom: 32 },
  form: { width: 480, display: 'flex', flexDirection: 'column', gap: 16 },
  label: { display: 'flex', flexDirection: 'column', fontSize: 12, opacity: 0.8 },
  input: {
    background: '#162033',
    border: '1px solid #2a3650',
    color: 'inherit',
    padding: '12px 14px',
    borderRadius: 8,
    fontSize: 16,
    marginTop: 4,
  },
  error: {
    background: '#3a1a1a',
    border: '1px solid #6b2828',
    padding: '10px 12px',
    borderRadius: 8,
    fontSize: 14,
  },
  button: {
    padding: '14px 16px',
    background: '#3b82f6',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 16,
    cursor: 'pointer',
  },
};
