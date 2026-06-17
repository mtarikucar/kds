import { useState } from 'react';
import { pairDevice } from '../api/mesh';
import type { DeviceToken } from '../store/deviceToken';
import { normalizePairCode } from './pairingLogic';

/**
 * Allow-list of hostnames the kiosk may pair against. The pair code is a
 * bearer secret that mints a long-lived device token; without this gate an
 * operator (or someone with brief physical access to the unattended pairing
 * screen) could point the kiosk at a malicious host and exfiltrate the code.
 * deep-review NM5.
 *
 * A host matches if it equals an allow-listed entry or is a subdomain of one.
 * To support genuine private/LAN self-host, extend this list at build time.
 */
const ALLOWED_API_HOSTS = ['hummytummy.com'] as const;

function hostAllowed(host: string): boolean {
  const h = host.toLowerCase();
  return ALLOWED_API_HOSTS.some((allowed) => h === allowed || h.endsWith(`.${allowed}`));
}

/**
 * Validate an operator-entered API URL before the pair code is sent to it:
 * must parse, must be https, and the host must be allow-listed. Returns a
 * normalized origin+path or throws with an operator-readable message.
 * deep-review NM5.
 */
export function validateApiUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('Invalid API URL');
  }
  if (url.protocol !== 'https:') {
    throw new Error('API URL must use https');
  }
  if (!hostAllowed(url.hostname)) {
    throw new Error(`API host not allowed: ${url.hostname}`);
  }
  // Strip any trailing slash so the joined `${apiUrl}/v1/...` stays well-formed.
  return raw.trim().replace(/\/+$/, '');
}

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
      // deep-review NM5: validate (https + host allow-list) BEFORE the pair
      // code leaves the device, so a malicious/typo'd API URL can never
      // receive the bearer secret.
      const safeUrl = validateApiUrl(apiUrl);
      const out = await pairDevice(safeUrl, normalizePairCode(pairCode));
      // Persist ONLY after the server has accepted the pair. The earlier
      // version wrote pre-pair, so a typo or attacker URL became the
      // persisted default even on failure — the next pair attempt's
      // code would then leak to that server.
      localStorage.setItem('kds_api_url', safeUrl);
      onPaired({ ...out, apiUrl: safeUrl });
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
