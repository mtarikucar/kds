import { BadRequestException } from "@nestjs/common";
import { AnalyticsController } from "./analytics.controller";
import { MockDataGeneratorService } from "./services/mock-data-generator.service";
import { HeatmapService } from "./services/heatmap.service";
import { TableAnalyticsService } from "./services/table-analytics.service";
import { InsightsService } from "./services/insights.service";
import { CameraService } from "./services/camera.service";
import { BranchScope } from "../../common/scoping/branch-scope";

/**
 * Long-tail spec for AnalyticsController. Two load-bearing behaviours:
 *  1) the shared date-window resolver (exercised via the occupancy heatmap
 *     endpoint) rejects Invalid Date / start>end with a 400 instead of
 *     silently returning an empty heatmap;
 *  2) camera CRUD + insight endpoints thread the BranchScope (and the
 *     acting user id on status updates) into their services.
 */
describe("AnalyticsController", () => {
  let mock: Record<string, jest.Mock>;
  let heatmap: Record<string, jest.Mock>;
  let tables: Record<string, jest.Mock>;
  let insights: Record<string, jest.Mock>;
  let camera: Record<string, jest.Mock>;
  let ctrl: AnalyticsController;
  const scope = { tenantId: "t1", branchId: "b1" } as unknown as BranchScope;
  const req = { tenantId: "t1", user: { id: "u1" } };

  beforeEach(() => {
    mock = { generateMockData: jest.fn(), clearMockData: jest.fn() };
    heatmap = { getOccupancyHeatmap: jest.fn().mockResolvedValue([]) };
    tables = {};
    insights = {
      getInsightById: jest.fn().mockResolvedValue({}),
      updateInsightStatus: jest.fn().mockResolvedValue({}),
      generateInsights: jest.fn().mockResolvedValue(3),
    };
    camera = {
      getCameras: jest.fn().mockResolvedValue([]),
      createCamera: jest.fn().mockResolvedValue({}),
      updateCamera: jest.fn().mockResolvedValue({}),
      getCameraById: jest.fn().mockResolvedValue({}),
    };
    ctrl = new AnalyticsController(
      mock as unknown as MockDataGeneratorService,
      heatmap as unknown as HeatmapService,
      tables as unknown as TableAnalyticsService,
      insights as unknown as InsightsService,
      camera as unknown as CameraService,
    );
  });

  describe("resolveRange (via occupancy heatmap)", () => {
    it("defaults the window and forwards tenant/branch when no dates given", async () => {
      await ctrl.getOccupancyHeatmap(req, scope, {} as any);
      const [tenantId, branchId, start, end] =
        heatmap.getOccupancyHeatmap.mock.calls[0];
      expect(tenantId).toBe("t1");
      expect(branchId).toBe("b1");
      expect(start).toBeInstanceOf(Date);
      expect(end).toBeInstanceOf(Date);
    });

    it("rejects an unparseable date (NaN) with 400 (defence in depth)", async () => {
      await expect(
        ctrl.getOccupancyHeatmap(req, scope, {
          startDate: "not-a-real-date",
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects start after end with 400", async () => {
      await expect(
        ctrl.getOccupancyHeatmap(req, scope, {
          startDate: "2026-06-10T00:00:00Z",
          endDate: "2026-06-01T00:00:00Z",
        } as any),
      ).rejects.toThrow(/before or equal/);
    });
  });

  describe("camera CRUD forwarding", () => {
    it("getCameras forwards the scope", async () => {
      await ctrl.getCameras(scope);
      expect(camera.getCameras).toHaveBeenCalledWith(scope);
    });

    it("createCamera forwards scope + dto", async () => {
      const dto = { name: "Cam", streamUrl: "rtsp://x" } as any;
      await ctrl.createCamera(scope, dto);
      expect(camera.createCamera).toHaveBeenCalledWith(scope, dto);
    });

    it("updateCamera forwards scope, id and dto", async () => {
      const dto = { name: "Renamed" } as any;
      await ctrl.updateCamera(scope, "cam-1", dto);
      expect(camera.updateCamera).toHaveBeenCalledWith(scope, "cam-1", dto);
    });
  });

  describe("insight forwarding", () => {
    it("getInsightById threads tenant + branch + id", async () => {
      await ctrl.getInsightById(req, scope, "ins-1");
      expect(insights.getInsightById).toHaveBeenCalledWith("t1", "b1", "ins-1");
    });

    it("updateInsightStatus threads the acting user id", async () => {
      const dto = { status: "REVIEWED" } as any;
      await ctrl.updateInsightStatus(req, scope, "ins-1", dto);
      expect(insights.updateInsightStatus).toHaveBeenCalledWith(
        "t1",
        "b1",
        "ins-1",
        "u1",
        dto,
      );
    });

    it("generateInsights wraps the count in a {generated} envelope", async () => {
      const out = await ctrl.generateInsights(req, scope);
      expect(out).toEqual({ generated: 3 });
    });
  });
});
