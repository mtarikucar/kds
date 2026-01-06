/**
 * Geolocation utilities for distance calculation and location validation
 * Used for QR menu security - ensuring customers are at the restaurant location
 */

/**
 * Calculate distance between two geographic coordinates using Haversine formula
 * @param lat1 - Latitude of first point
 * @param lon1 - Longitude of first point
 * @param lat2 - Latitude of second point
 * @param lon2 - Longitude of second point
 * @returns Distance in meters
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000; // Earth's radius in meters

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Convert degrees to radians
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Check if a location is within a given radius of a target location
 * @param customerLat - Customer's latitude
 * @param customerLon - Customer's longitude
 * @param targetLat - Target location latitude (restaurant)
 * @param targetLon - Target location longitude (restaurant)
 * @param maxDistanceMeters - Maximum allowed distance in meters
 * @returns Object with isWithinRange and actual distance
 */
export function isLocationWithinRange(
  customerLat: number,
  customerLon: number,
  targetLat: number,
  targetLon: number,
  maxDistanceMeters: number,
): { isWithinRange: boolean; distance: number } {
  const distance = calculateDistance(
    customerLat,
    customerLon,
    targetLat,
    targetLon,
  );

  return {
    isWithinRange: distance <= maxDistanceMeters,
    distance: Math.round(distance),
  };
}

/**
 * Validate if coordinates are valid (within acceptable ranges)
 * @param latitude - Latitude to validate (-90 to 90)
 * @param longitude - Longitude to validate (-180 to 180)
 * @returns true if coordinates are valid
 */
export function isValidCoordinates(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): boolean {
  if (latitude === null || latitude === undefined) return false;
  if (longitude === null || longitude === undefined) return false;

  return (
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}
