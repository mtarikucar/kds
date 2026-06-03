import { useEffect, useState } from 'react';
import PairingScreen from './screens/PairingScreen';
import KitchenScreen from './screens/KitchenScreen';
import { loadDeviceToken, saveDeviceToken, type DeviceToken } from './store/deviceToken';

/**
 * Root app.
 *
 * Two-state finite machine:
 *   - no device token in keyring -> render PairingScreen
 *   - device token present       -> render KitchenScreen
 *
 * Tokens live in the Tauri-side keyring (set via the `save_device_token`
 * command). The web layer never sees the raw token after the initial pair
 * call — it just knows "are we paired?" via `loadDeviceToken().exists`.
 */
export default function App() {
  const [token, setToken] = useState<DeviceToken | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDeviceToken()
      .then(setToken)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
        <span style={{ opacity: 0.5 }}>Loading…</span>
      </div>
    );
  }

  if (!token) {
    return (
      <PairingScreen
        onPaired={async (t) => {
          await saveDeviceToken(t);
          setToken(t);
        }}
      />
    );
  }

  return (
    <KitchenScreen
      token={token}
      onLogout={async () => {
        await saveDeviceToken(null);
        setToken(null);
      }}
    />
  );
}
