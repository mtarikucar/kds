import {
  PersonState,
  CameraStatus,
  CameraStreamType,
  InsightType,
  InsightSeverity,
  InsightStatus,
  HeatmapMetric,
  HeatmapGranularity,
} from "./analytics.enum";

/**
 * Long-tail drift-guard for the spatial-analytics enums. These values are
 * persisted (camera status, insight status lifecycle) and matched against
 * edge-device payloads, so value===name is load-bearing for serialization.
 */
describe("analytics.enum", () => {
  const valueEqualsName = (e: Record<string, string>) =>
    Object.entries(e).forEach(([name, value]) => expect(value).toBe(name));

  it("uses value===name for every analytics enum", () => {
    valueEqualsName(PersonState);
    valueEqualsName(CameraStatus);
    valueEqualsName(CameraStreamType);
    valueEqualsName(InsightType);
    valueEqualsName(InsightSeverity);
    valueEqualsName(InsightStatus);
    valueEqualsName(HeatmapMetric);
    valueEqualsName(HeatmapGranularity);
  });

  it("keeps the insight status lifecycle endpoints", () => {
    expect(InsightStatus.NEW).toBe("NEW");
    expect(InsightStatus.IMPLEMENTED).toBe("IMPLEMENTED");
    expect(InsightStatus.DISMISSED).toBe("DISMISSED");
  });

  it("defines the camera stream protocols incl RTSP/WEBRTC", () => {
    expect(CameraStreamType.RTSP).toBe("RTSP");
    expect(CameraStreamType.WEBRTC).toBe("WEBRTC");
  });
});
