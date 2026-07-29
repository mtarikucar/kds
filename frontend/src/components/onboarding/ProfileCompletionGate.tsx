import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useProfile } from '../../features/auth/authApi';
import { UserRole } from '../../types';

/**
 * Onboarding completion gate.
 *
 * Phone is required from registration onward (PayTR checkout needs it). A
 * SOCIAL signup (Google/Apple) can't collect it on a form, so it lands with no
 * phone — this gate routes such a user to the /welcome onboarding page until
 * they complete it. The backend /auth/complete-profile saves phone + business
 * details; once phone is set the gate releases. Runs OUTSIDE the
 * SubscriptionGate (complete the account first, then the plan lock applies).
 *
 * ADMIN-ONLY: the phone requirement exists for PayTR checkout — an admin
 * concern. Staff accounts created via team management have no phone and never
 * will; forcing a WAITER/KITCHEN/COURIER into /welcome trapped them on a form
 * whose business-name field was required (and, pre-fix, could rename the
 * restaurant). Staff therefore pass straight through.
 *
 * Recovery paths (the /welcome page itself, legal docs, help) stay reachable.
 */
const RECOVERY_PREFIXES = ['/welcome', '/legal', '/help'];

const ProfileCompletionGate = ({ children }: { children: React.ReactNode }) => {
  const { data: profile, isLoading } = useProfile();
  const location = useLocation();

  // Don't redirect before /auth/profile resolves — avoids a flash-redirect.
  if (isLoading) return <>{children}</>;

  const needsCompletion =
    !!profile && !profile.phone && profile.role === UserRole.ADMIN;
  const onRecoveryPath = RECOVERY_PREFIXES.some(
    (p) => location.pathname === p || location.pathname.startsWith(`${p}/`),
  );

  if (needsCompletion && !onRecoveryPath) {
    return <Navigate to="/welcome" replace />;
  }

  return <>{children}</>;
};

export default ProfileCompletionGate;
