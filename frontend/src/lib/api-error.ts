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
 * Returns null for non-axios errors (network failure, code bug) so
 * the caller can decide whether to surface a generic message.
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
 * Returns a stable function reference; no state.
 */
export function useApiErrorHandler() {
  return (err: unknown, fallbackKey: string) => {
    const fallback = i18n.t(fallbackKey, {
      defaultValue: 'Something went wrong. Please try again.',
    });
    toast.error(getApiErrorMessage(err, fallback));
  };
}
