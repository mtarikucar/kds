import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface MarketingUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'SALES_MANAGER' | 'SALES_REP';
  phone?: string;
  avatar?: string;
}

interface MarketingAuthState {
  user: MarketingUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;

  login: (user: MarketingUser, accessToken: string, refreshToken: string) => void;
  setAccessToken: (accessToken: string) => void;
  logout: () => void;
}

export const useMarketingAuthStore = create<MarketingAuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,

      login: (user: MarketingUser, accessToken: string, refreshToken: string) => {
        set({
          user,
          accessToken,
          refreshToken,
          isAuthenticated: true,
        });
      },

      setAccessToken: (accessToken: string) => {
        set({ accessToken });
      },

      logout: () => {
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
        });
      },
    }),
    {
      name: 'marketing-auth-storage',
      // Tokens (both access AND refresh) stay in memory only — persisting
      // either makes XSS a session-takeover primitive for a long-term
      // (30-day) stolen refresh. Matches the SuperAdmin store's stance.
      // On reload we rely on the persisted `user` flag to show the shell
      // and re-auth via /api/marketing/auth/refresh.
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
