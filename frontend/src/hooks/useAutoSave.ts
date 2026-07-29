import { useState, useEffect, useRef, useCallback } from 'react';

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface AutoSaveState {
  status: AutoSaveStatus;
  lastSaved?: Date;
  error?: string;
}

export interface AutoSaveOptions {
  debounceMs?: number;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

interface UseAutoSaveReturn<T> extends AutoSaveState {
  setValue: (value: T) => void;
  save: () => Promise<void>;
  retry: () => Promise<void>;
  /**
   * True from the moment an edit is queued (setValue) until that exact value
   * is confirmed saved. Stays true across an in-flight save AND after a
   * failed save (the local edit is still unpersisted). Pages use this to
   * SKIP re-hydrating local state from a query refetch — the refetch
   * triggered by save A must not clobber a newer edit B made mid-flight.
   */
  isDirty: boolean;
}

/**
 * Hook for auto-saving data with debounce support
 * @param initialValue - Initial value to track
 * @param saveFn - Function to save the value
 * @param options - Configuration options
 */
export function useAutoSave<T>(
  initialValue: T,
  saveFn: (value: T) => Promise<void>,
  options: AutoSaveOptions = {}
): UseAutoSaveReturn<T> {
  const { debounceMs = 800, onSuccess, onError } = options;

  const [state, setState] = useState<AutoSaveState>({
    status: 'idle',
  });
  const [isDirty, setIsDirty] = useState(false);

  const valueRef = useRef<T>(initialValue);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);
  const dirtyRef = useRef(false);
  // The unmount cleanup below runs with []-deps, so it would close over the
  // FIRST render's saveFn/callbacks. Keep live refs so the final flush uses
  // the latest ones.
  const saveFnRef = useRef(saveFn);
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    saveFnRef.current = saveFn;
    onSuccessRef.current = onSuccess;
    onErrorRef.current = onError;
  });

  const markDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
    if (isMountedRef.current) {
      setIsDirty(dirty);
    }
  }, []);

  // Update initial value when it changes — but NEVER while an unsaved edit is
  // pending. Pages pass their (query-hydrated) state as initialValue; if a
  // refetch clobbers that state while a debounced save is queued, re-syncing
  // here would make the pending save persist the REVERTED snapshot instead of
  // the user's latest edit.
  useEffect(() => {
    if (!dirtyRef.current) {
      valueRef.current = initialValue;
    }
  }, [initialValue]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        // FINAL FLUSH: a debounced save is still pending — silently dropping
        // it would lose the user's last edit on tab-switch/navigation. Fire
        // and forget with the latest value; no state updates (unmounted), but
        // the page-level toasts (sonner is global) still surface the result.
        Promise.resolve(saveFnRef.current(valueRef.current)).then(
          () => {
            dirtyRef.current = false;
            onSuccessRef.current?.();
          },
          (err) => {
            onErrorRef.current?.(
              err instanceof Error ? err : new Error('Save failed')
            );
          }
        );
      }
    };
  }, []);

  const performSave = useCallback(async () => {
    if (!isMountedRef.current) return;

    setState((prev) => ({ ...prev, status: 'saving', error: undefined }));

    try {
      // Capture what we are about to persist: if the user edits again while
      // this save is in flight, valueRef moves on and the state must REMAIN
      // dirty after this (now stale) save resolves.
      const savedValue = valueRef.current;
      await saveFn(savedValue);

      if (valueRef.current === savedValue) {
        markDirty(false);
      }

      if (!isMountedRef.current) return;

      setState({
        status: 'saved',
        lastSaved: new Date(),
        error: undefined,
      });

      onSuccess?.();

      // Reset to idle after 2 seconds
      setTimeout(() => {
        if (isMountedRef.current) {
          setState((prev) => ({
            ...prev,
            status: prev.status === 'saved' ? 'idle' : prev.status,
          }));
        }
      }, 2000);
    } catch (err) {
      if (!isMountedRef.current) return;

      const error = err instanceof Error ? err : new Error('Save failed');
      setState({
        status: 'error',
        error: error.message,
      });

      onError?.(error);
    }
  }, [saveFn, onSuccess, onError, markDirty]);

  const setValue = useCallback(
    (value: T) => {
      valueRef.current = value;
      markDirty(true);

      // Clear existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Set new timeout for debounced save. Null the ref when it fires so
      // the unmount cleanup can distinguish "save still pending" (flush it)
      // from "save already dispatched" (don't fire a duplicate).
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        performSave();
      }, debounceMs);
    },
    [debounceMs, performSave, markDirty]
  );

  const save = useCallback(async () => {
    // Clear any pending debounced save
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    await performSave();
  }, [performSave]);

  const retry = useCallback(async () => {
    await performSave();
  }, [performSave]);

  return {
    ...state,
    isDirty,
    setValue,
    save,
    retry,
  };
}

/**
 * Hook for tracking multiple auto-save fields
 */
export function useAutoSaveForm<T extends Record<string, unknown>>(
  initialValues: T,
  saveFn: (values: T) => Promise<void>,
  options: AutoSaveOptions = {}
): {
  values: T;
  setFieldValue: <K extends keyof T>(field: K, value: T[K]) => void;
  state: AutoSaveState;
  save: () => Promise<void>;
  retry: () => Promise<void>;
  isDirty: boolean;
} {
  const { debounceMs = 800, onSuccess, onError } = options;

  const [values, setValues] = useState<T>(initialValues);
  const [state, setState] = useState<AutoSaveState>({
    status: 'idle',
  });
  const [isDirty, setIsDirty] = useState(false);

  const valuesRef = useRef<T>(initialValues);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);
  const dirtyRef = useRef(false);
  const saveFnRef = useRef(saveFn);
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    saveFnRef.current = saveFn;
    onSuccessRef.current = onSuccess;
    onErrorRef.current = onError;
  });

  const markDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
    if (isMountedRef.current) {
      setIsDirty(dirty);
    }
  }, []);

  // Update initial values when they change — skipped while an unsaved edit is
  // pending (see useAutoSave: a refetch must not clobber a newer local edit).
  useEffect(() => {
    if (!dirtyRef.current) {
      setValues(initialValues);
      valuesRef.current = initialValues;
    }
  }, [initialValues]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        // FINAL FLUSH — see useAutoSave: never drop a pending edit on unmount.
        Promise.resolve(saveFnRef.current(valuesRef.current)).then(
          () => {
            dirtyRef.current = false;
            onSuccessRef.current?.();
          },
          (err) => {
            onErrorRef.current?.(
              err instanceof Error ? err : new Error('Save failed')
            );
          }
        );
      }
    };
  }, []);

  const performSave = useCallback(async () => {
    if (!isMountedRef.current) return;

    setState((prev) => ({ ...prev, status: 'saving', error: undefined }));

    try {
      const savedValues = valuesRef.current;
      await saveFn(savedValues);

      if (valuesRef.current === savedValues) {
        markDirty(false);
      }

      if (!isMountedRef.current) return;

      setState({
        status: 'saved',
        lastSaved: new Date(),
        error: undefined,
      });

      onSuccess?.();

      // Reset to idle after 2 seconds
      setTimeout(() => {
        if (isMountedRef.current) {
          setState((prev) => ({
            ...prev,
            status: prev.status === 'saved' ? 'idle' : prev.status,
          }));
        }
      }, 2000);
    } catch (err) {
      if (!isMountedRef.current) return;

      const error = err instanceof Error ? err : new Error('Save failed');
      setState({
        status: 'error',
        error: error.message,
      });

      onError?.(error);
    }
  }, [saveFn, onSuccess, onError, markDirty]);

  const setFieldValue = useCallback(
    <K extends keyof T>(field: K, value: T[K]) => {
      const newValues = { ...valuesRef.current, [field]: value };
      valuesRef.current = newValues;
      setValues(newValues);
      markDirty(true);

      // Clear existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Set new timeout for debounced save (nulled when it fires — see
      // useAutoSave's setValue).
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        performSave();
      }, debounceMs);
    },
    [debounceMs, performSave, markDirty]
  );

  const save = useCallback(async () => {
    // Clear any pending debounced save
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    await performSave();
  }, [performSave]);

  const retry = useCallback(async () => {
    await performSave();
  }, [performSave]);

  return {
    values,
    setFieldValue,
    state,
    save,
    retry,
    isDirty,
  };
}

export default useAutoSave;
