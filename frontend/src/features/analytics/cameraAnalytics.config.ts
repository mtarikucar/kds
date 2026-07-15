/**
 * Mirrors the backend `CAMERA_ANALYTICS_ENABLED` env flag. The camera /
 * computer-vision analytics suite — camera management, occupancy heatmaps,
 * traffic-flow + congestion, edge devices, calibration — ships INERT until
 * on-site cameras are provisioned. While false the camera + traffic tabs are
 * hidden and the camera-derived queries don't fire (the backend endpoints 404
 * in parallel). No component or type is deleted — flip this AND the backend
 * env var to reactivate the whole feature.
 */
export const CAMERA_ANALYTICS_ENABLED = false;
