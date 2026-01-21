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

  const valueRef = useRef<T>(initialValue);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  // Update initial value when it changes
  useEffect(() => {
    valueRef.current = initialValue;
  }, [initialValue]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const performSave = useCallback(async () => {
    if (!isMountedRef.current) return;

    setState((prev) => ({ ...prev, status: 'saving', error: undefined }));

    try {
      await saveFn(valueRef.current);

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
  }, [saveFn, onSuccess, onError]);

  const setValue = useCallback(
    (value: T) => {
      valueRef.current = value;

      // Clear existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Set new timeout for debounced save
      timeoutRef.current = setTimeout(() => {
        performSave();
      }, debounceMs);
    },
    [debounceMs, performSave]
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
} {
  const { debounceMs = 800, onSuccess, onError } = options;

  const [values, setValues] = useState<T>(initialValues);
  const [state, setState] = useState<AutoSaveState>({
    status: 'idle',
  });

  const valuesRef = useRef<T>(initialValues);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  // Update initial values when they change
  useEffect(() => {
    setValues(initialValues);
    valuesRef.current = initialValues;
  }, [initialValues]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const performSave = useCallback(async () => {
    if (!isMountedRef.current) return;

    setState((prev) => ({ ...prev, status: 'saving', error: undefined }));

    try {
      await saveFn(valuesRef.current);

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
  }, [saveFn, onSuccess, onError]);

  const setFieldValue = useCallback(
    <K extends keyof T>(field: K, value: T[K]) => {
      const newValues = { ...valuesRef.current, [field]: value };
      valuesRef.current = newValues;
      setValues(newValues);

      // Clear existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Set new timeout for debounced save
      timeoutRef.current = setTimeout(() => {
        performSave();
      }, debounceMs);
    },
    [debounceMs, performSave]
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
  };
}

export default useAutoSave;
