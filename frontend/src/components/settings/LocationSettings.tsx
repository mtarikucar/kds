import { useState, useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Circle, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useTranslation } from 'react-i18next';
import { MapPin, Navigation, Trash2, Save, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useGeolocation } from '../../hooks/useGeolocation';
import { useGetTenantSettings, useUpdateTenantSettings } from '../../hooks/useCurrency';
import { toast } from 'sonner';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icon in React-Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Map click handler component
function MapClickHandler({
  onLocationSelect,
}: {
  onLocationSelect: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click: (e) => {
      onLocationSelect(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Component to recenter map when position changes
function MapRecenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], map.getZoom());
  }, [lat, lng, map]);
  return null;
}

// Draggable marker component
function DraggableMarker({
  position,
  onPositionChange,
}: {
  position: [number, number];
  onPositionChange: (lat: number, lng: number) => void;
}) {
  const markerRef = useRef<L.Marker>(null);

  const eventHandlers = useMemo(
    () => ({
      dragend() {
        const marker = markerRef.current;
        if (marker) {
          const { lat, lng } = marker.getLatLng();
          onPositionChange(lat, lng);
        }
      },
    }),
    [onPositionChange]
  );

  return (
    <Marker
      draggable={true}
      eventHandlers={eventHandlers}
      position={position}
      ref={markerRef}
    />
  );
}

export default function LocationSettings() {
  const { t } = useTranslation('settings');
  const { data: settings, isLoading: settingsLoading } = useGetTenantSettings();
  const updateSettings = useUpdateTenantSettings();
  const { getCurrentPosition, loading: geoLoading, error: geoError } = useGeolocation();

  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [radius, setRadius] = useState(100);
  const [hasChanges, setHasChanges] = useState(false);

  // Default center (Turkey)
  const defaultCenter: [number, number] = [39.9334, 32.8597];
  const defaultZoom = 5;
  const selectedZoom = 17;

  // Load existing settings
  useEffect(() => {
    if (settings) {
      if (settings.latitude !== undefined && settings.latitude !== null) {
        setLatitude(settings.latitude);
      }
      if (settings.longitude !== undefined && settings.longitude !== null) {
        setLongitude(settings.longitude);
      }
      if (settings.locationRadius !== undefined && settings.locationRadius !== null) {
        setRadius(settings.locationRadius);
      }
    }
  }, [settings]);

  // Handle location selection from map click or marker drag
  const handleLocationSelect = (lat: number, lng: number) => {
    setLatitude(lat);
    setLongitude(lng);
    setHasChanges(true);
  };

  // Handle "Use my location" button
  const handleUseMyLocation = async () => {
    const position = await getCurrentPosition();
    if (position) {
      setLatitude(position.latitude);
      setLongitude(position.longitude);
      setHasChanges(true);
    }
  };

  // Handle radius change
  const handleRadiusChange = (value: number) => {
    setRadius(value);
    setHasChanges(true);
  };

  // Clear location
  const handleClearLocation = () => {
    setLatitude(null);
    setLongitude(null);
    setHasChanges(true);
  };

  // Save settings
  const handleSave = () => {
    updateSettings.mutate(
      {
        latitude: latitude,
        longitude: longitude,
        locationRadius: radius,
      },
      {
        onSuccess: () => {
          toast.success(t('locationSettings.saved', 'Konum ayarları kaydedildi'));
          setHasChanges(false);
        },
        onError: () => {
          toast.error(t('locationSettings.saveError', 'Konum ayarları kaydedilemedi'));
        },
      }
    );
  };

  // Determine map center
  const mapCenter: [number, number] =
    latitude !== null && longitude !== null ? [latitude, longitude] : defaultCenter;

  const currentZoom = latitude !== null && longitude !== null ? selectedZoom : defaultZoom;

  const hasLocation = latitude !== null && longitude !== null;

  if (settingsLoading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-indigo-100 rounded-lg">
          <MapPin className="w-5 h-5 text-indigo-600" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-slate-900">
            {t('locationSettings.title', 'Restoran Konumu')}
          </h3>
          <p className="text-sm text-slate-500">
            {t('locationSettings.description', 'QR menü siparişleri için konum doğrulaması ayarlayın')}
          </p>
        </div>
      </div>

      {/* Status indicator */}
      <div className={`flex items-center gap-2 p-3 rounded-lg mb-4 ${hasLocation ? 'bg-green-50' : 'bg-yellow-50'}`}>
        {hasLocation ? (
          <>
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            <span className="text-sm text-green-800">
              {t('locationSettings.locationEnabled', 'Konum doğrulaması aktif')}
            </span>
          </>
        ) : (
          <>
            <AlertCircle className="w-5 h-5 text-yellow-600" />
            <span className="text-sm text-yellow-800">
              {t('locationSettings.locationDisabled', 'Konum doğrulaması kapalı (koordinat girilmedi)')}
            </span>
          </>
        )}
      </div>

      {/* Map */}
      <div className="mb-4">
        <p className="text-sm text-slate-600 mb-2">
          {t('locationSettings.mapInstructions', 'Haritaya tıklayarak veya marker\'ı sürükleyerek konum seçin')}
        </p>
        <div className="h-80 rounded-lg overflow-hidden border border-slate-200">
          <MapContainer
            center={mapCenter}
            zoom={currentZoom}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapClickHandler onLocationSelect={handleLocationSelect} />
            {hasLocation && (
              <>
                <MapRecenter lat={latitude!} lng={longitude!} />
                <DraggableMarker
                  position={[latitude!, longitude!]}
                  onPositionChange={handleLocationSelect}
                />
                <Circle
                  center={[latitude!, longitude!]}
                  radius={radius}
                  pathOptions={{
                    color: '#4F46E5',
                    fillColor: '#4F46E5',
                    fillOpacity: 0.2,
                  }}
                />
              </>
            )}
          </MapContainer>
        </div>
      </div>

      {/* Use my location button */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          type="button"
          onClick={handleUseMyLocation}
          disabled={geoLoading}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {geoLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Navigation className="w-4 h-4" />
          )}
          {t('locationSettings.useMyLocation', 'Konumumu Kullan')}
        </button>
        {hasLocation && (
          <button
            type="button"
            onClick={handleClearLocation}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            {t('locationSettings.clearLocation', 'Konumu Temizle')}
          </button>
        )}
      </div>

      {geoError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">{geoError}</p>
        </div>
      )}

      {/* Coordinate inputs */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            {t('locationSettings.latitude', 'Enlem')}
          </label>
          <input
            type="number"
            step="any"
            value={latitude ?? ''}
            onChange={(e) => {
              const val = e.target.value ? parseFloat(e.target.value) : null;
              setLatitude(val);
              setHasChanges(true);
            }}
            placeholder="39.9334"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            {t('locationSettings.longitude', 'Boylam')}
          </label>
          <input
            type="number"
            step="any"
            value={longitude ?? ''}
            onChange={(e) => {
              const val = e.target.value ? parseFloat(e.target.value) : null;
              setLongitude(val);
              setHasChanges(true);
            }}
            placeholder="32.8597"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Radius slider */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-slate-700 mb-1">
          {t('locationSettings.radius', 'Sipariş Yarıçapı')}: {radius} {t('locationSettings.meters', 'metre')}
        </label>
        <p className="text-xs text-slate-500 mb-2">
          {t('locationSettings.radiusHelp', 'Müşterilerin sipariş verebileceği maksimum mesafe')}
        </p>
        <input
          type="range"
          min="10"
          max="1000"
          step="10"
          value={radius}
          onChange={(e) => handleRadiusChange(parseInt(e.target.value))}
          className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
        />
        <div className="flex justify-between text-xs text-slate-500 mt-1">
          <span>10m</span>
          <span>500m</span>
          <span>1000m</span>
        </div>
      </div>

      {/* Save button */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={updateSettings.isPending || !hasChanges}
          className="flex items-center gap-2 px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {updateSettings.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {t('common.save', 'Kaydet')}
        </button>
      </div>
    </div>
  );
}
