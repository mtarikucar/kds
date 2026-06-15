import { useCallback, useEffect, useState, type RefObject } from 'react';

const STORAGE_KEY = 'kds-kiosk';

/**
 * Opt-in kiosk mode for the Kitchen Display. Persists the on/off choice in
 * localStorage so a dedicated kitchen tablet stays in kiosk mode across
 * reloads, and drives the Fullscreen API on a passed element ref:
 *   - enabling  → request fullscreen on the ref (covers app chrome)
 *   - disabling → exit fullscreen
 * All Fullscreen calls are guarded so unsupported browsers (or a denied
 * request) degrade to the dark high-contrast theme without throwing.
 */
export function useKioskMode(targetRef?: RefObject<HTMLElement | null>) {
  const [kiosk, setKiosk] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Persist the choice.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(kiosk));
    } catch {
      // Storage may be unavailable (private mode / quota); kiosk still works
      // for this session, just won't persist.
    }
  }, [kiosk]);

  // Drive the Fullscreen API off the kiosk flag. Guarded for unsupported
  // browsers and for the user-gesture requirement — a rejected request just
  // leaves the dark theme applied without fullscreen.
  useEffect(() => {
    const el = targetRef?.current;
    if (kiosk) {
      if (el && el.requestFullscreen && !document.fullscreenElement) {
        el.requestFullscreen().catch(() => {
          /* denied or unsupported — theme still applies */
        });
      }
    } else if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {
        /* ignore */
      });
    }
  }, [kiosk, targetRef]);

  // Keep state in sync when the user leaves fullscreen via the Esc key /
  // browser UI rather than our toggle, so the theme and the button icon match
  // the actual fullscreen state.
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) {
        setKiosk((prev) => (prev ? false : prev));
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggle = useCallback(() => setKiosk((prev) => !prev), []);

  return { kiosk, toggle };
}

export default useKioskMode;
