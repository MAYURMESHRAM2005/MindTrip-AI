const EARTH_RADIUS_KM = 6371;

/**
 * Haversine distance in kilometres between two lat/lng points.
 * Used as an approximation when Distance Matrix is unavailable.
 */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/**
 * Estimate drive time in minutes at an assumed average speed.
 * Clearly an estimate - used only when live travel-time data is unavailable.
 */
export function estimateDriveMinutes(km, avgSpeedKmh = 40) {
  return Math.round((km / avgSpeedKmh) * 60);
}

export default { haversineKm, estimateDriveMinutes };
