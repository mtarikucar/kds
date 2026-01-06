import { useState, useCallback } from 'react';

export interface GeolocationState {
  latitude: number | null;
  longitude: number | null;
  error: string | null;
  loading: boolean;
  permissionStatus: 'prompt' | 'granted' | 'denied' | 'unavailable';
}

export interface UseGeolocationOptions {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
}

const defaultOptions: UseGeolocationOptions = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 60000, // 1 minute cache
};

export function useGeolocation(options: UseGeolocationOptions = {}) {
  const [state, setState] = useState<GeolocationState>({
    latitude: null,
    longitude: null,
    error: null,
    loading: false,
    permissionStatus: 'prompt',
  });

  const mergedOptions = { ...defaultOptions, ...options };

  const getCurrentPosition = useCallback(async (): Promise<{
    latitude: number;
    longitude: number;
  } | null> => {
    if (!navigator.geolocation) {
      setState(prev => ({
        ...prev,
        error: 'Geolocation is not supported by your browser',
        permissionStatus: 'unavailable',
      }));
      return null;
    }

    setState(prev => ({ ...prev, loading: true, error: null }));

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setState({
            latitude,
            longitude,
            error: null,
            loading: false,
            permissionStatus: 'granted',
          });
          resolve({ latitude, longitude });
        },
        (error) => {
          let errorMessage: string;
          let permissionStatus: GeolocationState['permissionStatus'] = 'denied';

          switch (error.code) {
            case error.PERMISSION_DENIED:
              errorMessage = 'Konum izni reddedildi. Lütfen tarayıcı ayarlarından konum iznini etkinleştirin.';
              permissionStatus = 'denied';
              break;
            case error.POSITION_UNAVAILABLE:
              errorMessage = 'Konum bilgisi alınamadı. Lütfen GPS\'inizi açın.';
              permissionStatus = 'unavailable';
              break;
            case error.TIMEOUT:
              errorMessage = 'Konum isteği zaman aşımına uğradı. Lütfen tekrar deneyin.';
              permissionStatus = 'prompt';
              break;
            default:
              errorMessage = 'Konum alınırken bir hata oluştu.';
              permissionStatus = 'prompt';
          }

          setState({
            latitude: null,
            longitude: null,
            error: errorMessage,
            loading: false,
            permissionStatus,
          });
          resolve(null);
        },
        {
          enableHighAccuracy: mergedOptions.enableHighAccuracy,
          timeout: mergedOptions.timeout,
          maximumAge: mergedOptions.maximumAge,
        }
      );
    });
  }, [mergedOptions.enableHighAccuracy, mergedOptions.timeout, mergedOptions.maximumAge]);

  const checkPermission = useCallback(async (): Promise<PermissionState | null> => {
    if (!navigator.permissions) {
      return null;
    }

    try {
      const result = await navigator.permissions.query({ name: 'geolocation' });
      setState(prev => ({
        ...prev,
        permissionStatus: result.state as GeolocationState['permissionStatus'],
      }));
      return result.state;
    } catch {
      return null;
    }
  }, []);

  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  return {
    ...state,
    getCurrentPosition,
    checkPermission,
    clearError,
  };
}

export default useGeolocation;
