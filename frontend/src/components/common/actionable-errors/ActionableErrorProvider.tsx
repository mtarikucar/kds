import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { getApiErrorCode } from '../../../lib/api-error';
import { getActionableErrorSpec, type ActionableErrorSpec } from './actionableErrors';
import ActionableErrorModal from './ActionableErrorModal';

interface PendingFix {
  spec: ActionableErrorSpec;
  retry: () => void;
}

interface ActionableErrorContextValue {
  /**
   * Inspect a caught API error. If it carries a known actionable `errorCode`,
   * open the inline-fix prompt (which resumes by calling `retry` after the
   * missing field is saved) and return true. Otherwise return false so the
   * caller falls back to its normal error handling (toast/inline message).
   *
   *   onError: (err) => {
   *     if (handleApiError(err, () => doAction())) return;
   *     toast.error(getApiErrorMessage(err, fallback));
   *   }
   */
  handleApiError: (err: unknown, retry: () => void) => boolean;
}

const ActionableErrorContext = createContext<ActionableErrorContextValue | null>(null);

export function ActionableErrorProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingFix | null>(null);

  const handleApiError = useCallback((err: unknown, retry: () => void): boolean => {
    const spec = getActionableErrorSpec(getApiErrorCode(err));
    if (!spec) return false;
    setPending({ spec, retry });
    return true;
  }, []);

  return (
    <ActionableErrorContext.Provider value={{ handleApiError }}>
      {children}
      {pending && (
        <ActionableErrorModal
          spec={pending.spec}
          onCancel={() => setPending(null)}
          onResolved={() => {
            const { retry } = pending;
            setPending(null);
            retry();
          }}
        />
      )}
    </ActionableErrorContext.Provider>
  );
}

/**
 * Access the actionable-error handler. Safe to call outside the provider —
 * returns a no-op `handleApiError` that always returns false (so callers
 * still fall through to their normal error handling).
 */
export function useActionableError(): ActionableErrorContextValue {
  const ctx = useContext(ActionableErrorContext);
  if (!ctx) {
    return { handleApiError: () => false };
  }
  return ctx;
}
