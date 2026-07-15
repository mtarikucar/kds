import { CanActivate, Injectable, NotFoundException } from "@nestjs/common";

/**
 * The camera / computer-vision analytics suite — camera management, occupancy
 * heatmaps, traffic-flow + congestion, edge-device ingest and calibration —
 * ships INERT until on-site cameras are actually provisioned. Nothing about it
 * is deleted: the services, schema models (Camera / OccupancyRecord /
 * TrafficFlowRecord / EdgeDevice) and DTOs all remain, dormant. A single env
 * flag reactivates the whole feature.
 *
 * Non-camera analytics (table utilization/trends, sales insights, customer
 * behavior) are deliberately NOT gated — they read order-derived data and stay
 * live.
 *
 * To reactivate: set CAMERA_ANALYTICS_ENABLED=true on the backend AND
 * CAMERA_ANALYTICS_ENABLED (VITE build arg) on the frontend.
 */
export function isCameraAnalyticsEnabled(): boolean {
  return process.env.CAMERA_ANALYTICS_ENABLED === "true";
}

/**
 * Route guard for the camera/CV endpoints. When the feature is inert it throws
 * 404 (the endpoints look absent, not forbidden) so a probe can't tell a
 * disabled feature from a missing one.
 */
@Injectable()
export class CameraAnalyticsEnabledGuard implements CanActivate {
  canActivate(): boolean {
    if (isCameraAnalyticsEnabled()) return true;
    throw new NotFoundException("Camera analytics is not enabled");
  }
}
