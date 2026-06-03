import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User } from '../types';

/**
 * Auth store with a split-persistence model:
 *
 * - `accessToken` is held in memory ONLY (never persisted). An XSS on the
 *   admin origin cannot drain the token out of localStorage because it
 *   isn't there. On reload the SPA calls /api/auth/refresh with the
 *   httpOnly refresh cookie to mint a fresh access token.
 *
 * - `user` + `isAuthenticated` ARE persisted so the app can render the
 *   authenticated shell immediately on boot (skeleton UI, correct nav)
 *   while the refresh-token handshake runs. These don't carry credentials.
 *
 * - The refresh token itself lives server-side in an httpOnly cookie set
 *   by /api/auth/*; it never touches JavaScript.
 *
 * `logout()` stays sync/local so the 401 interceptor in lib/api.ts can
 * call it without re-entrancy risk. The canonical user-initiated logout
 * (features/auth/authApi.ts `useLogout`) calls POST /auth/logout FIRST
 * to revoke the refresh cookie + bump tokenVersion, then calls this
 * `logout()` to clear local state. For the 401-retry path the refresh
 * token is already invalid — no point re-contacting the backend.
 */
interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  setUser: (user: User) => void;
  setAccessToken: (accessToken: string) => void;
  login: (user: User, accessToken: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      isAuthenticated: false,

      setUser: (user: User) => {
        set({ user, isAuthenticated: true });
      },

      setAccessToken: (accessToken: string) => {
        set({ accessToken });
      },

      login: (user: User, accessToken: string) => {
        set({
          user,
          accessToken,
          isAuthenticated: true,
        });
      },

      logout: () => {
        set({
          user: null,
          accessToken: null,
          isAuthenticated: false,
        });
        // v2.8.97 — explicitly drop the persisted snapshot. Pre-fix
        // `set({user:null})` cleared the in-memory store but Zustand's
        // persist middleware writes-back on the next mutation cycle,
        // and a quick "logout → new login on same device" sequence
        // could surface the previous user.name / email briefly before
        // the new login set landed. Removing the storage key on
        // logout makes the boot path see a clean slate.
        if (typeof window !== 'undefined') {
          try {
            window.localStorage.removeItem('auth-storage');
          } catch {
            // Storage unavailable — fine; the in-memory clear above is
            // sufficient for this session.
          }
        }
      },
    }),
    {
      name: 'auth-storage',
      // Deliberately NOT persisting accessToken — memory only.
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);
