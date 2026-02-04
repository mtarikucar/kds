import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SuperAdmin } from '../features/superadmin/types';

interface SuperAdminAuthState {
  superAdmin: SuperAdmin | null;
  accessToken: string | null;
  refreshToken: string | null;
  tempToken: string | null;
  isAuthenticated: boolean;
  requires2FA: boolean;
  requires2FASetup: boolean;

  setSuperAdmin: (superAdmin: SuperAdmin) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  setAccessToken: (accessToken: string) => void;
  setTempToken: (tempToken: string, needsSetup?: boolean) => void;
  setRequires2FA: (requires: boolean) => void;
  setRequires2FASetup: (requires: boolean) => void;
  login: (superAdmin: SuperAdmin, accessToken: string, refreshToken: string) => void;
  logout: () => void;
}

export const useSuperAdminAuthStore = create<SuperAdminAuthState>()(
  persist(
    (set) => ({
      superAdmin: null,
      accessToken: null,
      refreshToken: null,
      tempToken: null,
      isAuthenticated: false,
      requires2FA: false,
      requires2FASetup: false,

      setSuperAdmin: (superAdmin: SuperAdmin) => {
        set({ superAdmin, isAuthenticated: true });
      },

      setTokens: (accessToken: string, refreshToken: string) => {
        set({ accessToken, refreshToken });
      },

      setAccessToken: (accessToken: string) => {
        set({ accessToken });
      },

      setTempToken: (tempToken: string, needsSetup?: boolean) => {
        set({
          tempToken,
          requires2FA: !needsSetup,
          requires2FASetup: !!needsSetup
        });
      },

      setRequires2FA: (requires: boolean) => {
        set({ requires2FA: requires });
      },

      setRequires2FASetup: (requires: boolean) => {
        set({ requires2FASetup: requires });
      },

      login: (superAdmin: SuperAdmin, accessToken: string, refreshToken: string) => {
        set({
          superAdmin,
          accessToken,
          refreshToken,
          tempToken: null,
          isAuthenticated: true,
          requires2FA: false,
          requires2FASetup: false,
        });
      },

      logout: () => {
        set({
          superAdmin: null,
          accessToken: null,
          refreshToken: null,
          tempToken: null,
          isAuthenticated: false,
          requires2FA: false,
          requires2FASetup: false,
        });
      },
    }),
    {
      name: 'superadmin-auth-storage',
      partialize: (state) => ({
        superAdmin: state.superAdmin,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
