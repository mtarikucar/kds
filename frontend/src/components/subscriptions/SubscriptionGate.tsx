import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSubscription } from '../../contexts/SubscriptionContext';

/**
 * Onboarding-trial lock (frontend half).
 *
 * When a tenant's onboarding trial has ended without a paid subscription the
 * backend marks it TRIAL_ENDED (and EXPIRED/CANCELLED are likewise not live).
 * Such a tenant is LOCKED: this gate redirects every in-app route to the
 * plan-selection screen until they activate a paid plan. The backend's global
 * SubscriptionStatusGuard is the real enforcement (403 PLAN_SELECTION_REQUIRED);
 * this gate is the UX so the user lands on /subscription/plans instead of
 * hitting a wall of 403s.
 *
 * Recovery paths (plan selection, checkout, profile, legal, help) stay
 * reachable so the user can actually pick + pay + read the consent docs.
 */
const RECOVERY_PREFIXES = [
  '/subscription',
  '/admin/plan',
  '/profile',
  '/legal',
  '/help',
];

const SubscriptionGate = ({ children }: { children: React.ReactNode }) => {
  const { subscription, isLoading } = useSubscription();
  const location = useLocation();

  // Don't redirect while the subscription query is still resolving — avoids a
  // flash-redirect before the real status arrives.
  if (isLoading) return <>{children}</>;

  const status = subscription?.status;
  const isLive =
    status === 'ACTIVE' || status === 'TRIALING' || status === 'PAST_DUE';
  // Lock only on an explicit not-live status (TRIAL_ENDED / EXPIRED /
  // CANCELLED). A null subscription (no data / query error) is left to the API
  // interceptor + backend guard rather than risking a false lock here.
  const isLocked = !!subscription && !isLive;

  const onRecoveryPath = RECOVERY_PREFIXES.some(
    (p) =>
      location.pathname === p || location.pathname.startsWith(`${p}/`),
  );

  if (isLocked && !onRecoveryPath) {
    return <Navigate to="/subscription/plans" replace state={{ locked: true }} />;
  }

  return <>{children}</>;
};

export default SubscriptionGate;
