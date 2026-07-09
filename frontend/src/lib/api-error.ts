/**
 * v3.0.0 — typed error handling for the centralized axios client.
 *
 * Pre-v3 every feature API repeated:
 *
 *   onError: (error: any) => {
 *     toast.error(error.response?.data?.message || i18n.t('...'))
 *   }
 *
 * which (a) leaks `any` casts across the feature surface, (b) leaves
 * the error shape implicit, and (c) duplicates the same fallback
 * across ~30 mutation hooks. The helpers below unify all three:
 *
 *   const handleApiError = useApiErrorHandler();
 *   useMutation({ onError: (err) => handleApiError(err, 'pos:orderCreateFailed') });
 *
 *   // Or inline:
 *   toast.error(getApiErrorMessage(err, i18n.t('pos:orderCreateFailed')));
 *
 * The error type captures the shape NestJS controllers return for
 * domain failures (HttpException → { statusCode, message, errorCode }).
 */
import { AxiosError, isAxiosError } from 'axios';
import { useCallback } from 'react';
import { toast } from 'sonner';
import i18n from '../i18n/config';

/**
 * The error response shape used by every NestJS HttpException in this
 * codebase. `message` is sometimes a string and sometimes an array of
 * strings (class-validator pipe), so the helper below flattens both.
 * `errorCode` is the optional machine-readable code controllers attach
 * for paths the UI needs to handle specially (e.g. `PROFILE_PHONE_REQUIRED`).
 */
export interface ApiErrorBody {
  statusCode?: number;
  message?: string | string[];
  errorCode?: string;
  error?: string;
}

export type ApiError = AxiosError<ApiErrorBody>;

/**
 * Narrow an unknown caught error to the standard ApiError shape.
 *
 * Returns null for non-axios errors. That includes:
 *   - Network failures the axios instance never wrapped (rare; the
 *     interceptor in `lib/api.ts` normally rejects with AxiosError)
 *   - DOMException / AbortError from a cancelled request
 *   - Plain `throw new Error(...)` or `throw 'string'` from caller code
 *   - Errors from the queryFn body unrelated to the HTTP layer
 *
 * Because `null` collapses every non-HTTP failure into the same bucket,
 * downstream helpers (`getApiErrorStatus`, `getApiErrorCode`) also
 * return `undefined` on those paths. Callers that need to differentiate
 * "got a 401" from "lost network entirely" must check `getApiErrorStatus`
 * against undefined explicitly — undefined here means "no response
 * landed", and any 401-refresh logic must treat that as not-an-auth-error.
 */
export function asApiError(err: unknown): ApiError | null {
  if (isAxiosError(err)) {
    return err as ApiError;
  }
  return null;
}

/**
 * Extract a user-facing message from an unknown error, falling back to
 * `fallback` when the error doesn't carry one. Handles three shapes:
 *
 *   - axios error with `{ message: string }` body → returned verbatim
 *   - axios error with `{ message: string[] }` body → joined with "; "
 *     (class-validator returns an array of one per failed field)
 *   - non-axios / no body → `fallback`
 */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  const api = asApiError(err);
  // Prefer a localized message when the backend attached a machine-readable
  // `errorCode` we have a translation for. NestJS HttpException `message`s are
  // hardcoded English ("Invalid email or password"), so without this step the
  // toast shows English even under a Turkish / Arabic / Russian / Uzbek locale.
  // Only codes present in `errors:apiCodes` are localized; anything else (e.g.
  // field-specific class-validator messages under VALIDATION_ERROR) keeps the
  // more-specific backend message below.
  const code = api?.response?.data?.errorCode;
  if (code) {
    // i18n.exists() (not t() with a defaultValue) — for an unmapped code
    // i18next returns the key string itself, which is truthy and would leak
    // "apiCodes.SOME_CODE" into the toast. exists() only passes for codes we
    // actually translated.
    const key = `errors:apiCodes.${code}`;
    if (i18n.exists(key)) return i18n.t(key);
  }
  const raw = api?.response?.data?.message;
  if (typeof raw === 'string' && raw.length > 0) return raw;
  if (Array.isArray(raw) && raw.length > 0) return raw.join('; ');
  return fallback;
}

/**
 * The machine-readable `errorCode` field on the response body, if
 * present. Used by paths that branch on it (phone-required modal,
 * payment-pending banner, etc.).
 */
export function getApiErrorCode(err: unknown): string | undefined {
  return asApiError(err)?.response?.data?.errorCode;
}

/**
 * HTTP status from the response, undefined when no response landed
 * (network error, request aborted, CORS preflight failure).
 */
export function getApiErrorStatus(err: unknown): number | undefined {
  return asApiError(err)?.response?.status;
}

/**
 * Convenience hook for the most common pattern: toast an i18n message
 * when a mutation fails. The optional `fallbackKey` is resolved via
 * the shared i18n instance so the toast is always localized.
 *
 *   const handle = useApiErrorHandler();
 *   useMutation({ onError: (e) => handle(e, 'devices:createFailed') });
 *
 * v3.0.1 audit fix (round 2) — wrapped in `useCallback` so the returned
 * function has a stable identity across renders. Pre-fix the body
 * returned a freshly-allocated arrow on every render; `useMutation`'s
 * `onError` closure binding was fine in practice (read-once), but any
 * caller using `handle` as a dependency in `useEffect` / `useMemo` /
 * `useCallback` saw spurious re-runs. `i18n` and `toast` are stable
 * module-level refs, so the empty deps array is correct.
 */
export function useApiErrorHandler() {
  return useCallback((err: unknown, fallbackKey: string) => {
    const fallback = i18n.t(fallbackKey, {
      defaultValue: 'Something went wrong. Please try again.',
    });
    toast.error(getApiErrorMessage(err, fallback));
  }, []);
}
