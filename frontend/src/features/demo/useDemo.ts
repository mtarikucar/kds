import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import i18n from '../../i18n/config';
import api from '../../lib/api';
import { getApiErrorMessage } from '../../lib/api-error';
import { useAuthStore } from '../../store/authStore';
import { useBranchScopeStore } from '../../store/branchScopeStore';
import { User } from '../../types';

interface DemoSessionResponse {
  accessToken: string;
  user: User & { isDemo: true };
}

/**
 * Demo-mode entry. POSTs /auth/demo-session (mints an access-only demo token
 * for the shared demo restaurant; lazily seeds it on first call), then swaps the
 * in-memory session to the demo user/token and re-points the branch scope at the
 * demo branch. The real session is stashed by authStore.enterDemo so exitDemo
 * restores it without touching the real refresh cookie.
 *
 * Order matters: set the demo token + branch BEFORE clearing the query cache so
 * the refetch storm that clear() triggers flies with the demo context (token +
 * X-Branch-Id), never a stale mix of real-token / demo-branch.
 */
export function useEnterDemo() {
  const [isPending, setIsPending] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const enterDemo = async (): Promise<boolean> => {
    if (useAuthStore.getState().demoMode) {
      navigate('/dashboard');
      return true;
    }
    setIsPending(true);
    try {
      const { data } =
        await api.post<DemoSessionResponse>('/auth/demo-session');
      useAuthStore.getState().enterDemo(data.user, data.accessToken);
      useBranchScopeStore.getState().hydrateFromUser(data.user);
      queryClient.clear();
      navigate('/dashboard');
      toast.success(
        i18n.t('demo.entered', {
          ns: 'common',
          defaultValue: 'Demo restoranına geçildi.',
        }),
      );
      return true;
    } catch (e) {
      toast.error(
        getApiErrorMessage(
          e,
          i18n.t('demo.enterFailed', {
            ns: 'common',
            defaultValue: 'Demo başlatılamadı',
          }),
        ),
      );
      return false;
    } finally {
      setIsPending(false);
    }
  };

  return { enterDemo, isPending };
}

/**
 * Restores the real session stashed by enterDemo. The restored access token may
 * have lapsed during the demo browse; the 401 interceptor refreshes it from the
 * still-valid httpOnly cookie on the next request.
 */
export function useExitDemo() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const exitDemo = () => {
    if (!useAuthStore.getState().demoMode) return;
    const realUser = useAuthStore.getState().realSession?.user ?? null;
    useAuthStore.getState().exitDemo();
    useBranchScopeStore.getState().hydrateFromUser(realUser);
    queryClient.clear();
    navigate('/dashboard');
    toast.success(
      i18n.t('demo.exited', {
        ns: 'common',
        defaultValue: 'Kendi hesabınıza döndünüz.',
      }),
    );
  };

  return { exitDemo };
}
