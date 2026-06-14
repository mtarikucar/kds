// Pure helpers extracted (verbatim) from SuperAdminLoginPage so they can be
// unit-tested in isolation. The component re-imports them at the original
// call sites, so runtime behavior is byte-identical.

// One-shot read of the deeplink path stashed by superAdminApi.ts's 401
// interceptor (warm-session expiry → hard reload → state lost).
// Cleared on read so a later visit to /superadmin/login doesn't reuse
// a stale target.
export function readAndClearReturnPath(): string | null {
  try {
    const value = window.sessionStorage.getItem('superAdminPostLoginReturn');
    if (value) window.sessionStorage.removeItem('superAdminPostLoginReturn');
    return value;
  } catch {
    return null;
  }
}

// Internal-path allow-list + self-loop guard. Same internal-path validation +
// self-loop guard as the tenant LoginPage. Returns the validated deeplink
// target or the dashboard fallback. `candidate` is the (already read) stashed
// return path, or null when none / not in a browser.
export function resolvePostLoginTarget(candidate: string | null): string {
  if (
    candidate &&
    /^\/[^/]/.test(candidate) &&
    candidate.startsWith('/superadmin/') &&
    !candidate.startsWith('/superadmin/login')
  ) {
    return candidate;
  }
  return '/superadmin/dashboard';
}
