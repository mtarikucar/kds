import { NotFoundException } from "@nestjs/common";
import {
  CameraAnalyticsEnabledGuard,
  isCameraAnalyticsEnabled,
} from "./camera-analytics.gate";

/**
 * The camera/CV analytics suite ships INERT (CAMERA_ANALYTICS_ENABLED). This
 * pins the gate: enabled ONLY when the flag is exactly "true"; the guard 404s
 * (looks-absent) otherwise so a probe can't distinguish disabled from missing.
 */
describe("camera-analytics gate", () => {
  const orig = process.env.CAMERA_ANALYTICS_ENABLED;
  afterEach(() => {
    if (orig === undefined) delete process.env.CAMERA_ANALYTICS_ENABLED;
    else process.env.CAMERA_ANALYTICS_ENABLED = orig;
  });

  it("is disabled by default (unset) and for any non-'true' value", () => {
    delete process.env.CAMERA_ANALYTICS_ENABLED;
    expect(isCameraAnalyticsEnabled()).toBe(false);
    process.env.CAMERA_ANALYTICS_ENABLED = "false";
    expect(isCameraAnalyticsEnabled()).toBe(false);
    process.env.CAMERA_ANALYTICS_ENABLED = "1";
    expect(isCameraAnalyticsEnabled()).toBe(false);
    process.env.CAMERA_ANALYTICS_ENABLED = "TRUE";
    expect(isCameraAnalyticsEnabled()).toBe(false);
  });

  it("is enabled only for the exact string 'true'", () => {
    process.env.CAMERA_ANALYTICS_ENABLED = "true";
    expect(isCameraAnalyticsEnabled()).toBe(true);
  });

  it("guard throws 404 NotFound when inert, passes when enabled", () => {
    const guard = new CameraAnalyticsEnabledGuard();
    delete process.env.CAMERA_ANALYTICS_ENABLED;
    expect(() => guard.canActivate()).toThrow(NotFoundException);
    process.env.CAMERA_ANALYTICS_ENABLED = "true";
    expect(guard.canActivate()).toBe(true);
  });
});
