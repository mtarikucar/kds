import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateCameraDto } from "./camera.dto";
import { DateRangeDto, HeatmapQueryDto } from "./date-range.dto";
import { UpdateInsightStatusDto, InsightFilterDto } from "./insight.dto";
import { HeatmapGranularity, InsightStatus } from "../enums/analytics.enum";

/**
 * Long-tail validation spec for the analytics DTOs. Load-bearing rules:
 * camera FOV/rotation are bounded numbers (a bad value would mis-project the
 * floor-plan heatmap); heatmap granularity + insight status are closed
 * enums; insight filter pagination is clamped.
 */
async function errs(dto: object): Promise<string[]> {
  const results = await validate(dto);
  return results.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe("CreateCameraDto", () => {
  const base = { name: "Entrance", streamUrl: "rtsp://x/stream" };

  it("accepts a minimal valid camera", async () => {
    expect(await errs(plainToInstance(CreateCameraDto, base))).toEqual([]);
  });

  it("coerces an empty-string rotation and accepts it in range", async () => {
    const dto = plainToInstance(CreateCameraDto, { ...base, rotationY: "45" });
    expect(await errs(dto)).toEqual([]);
    expect(dto.rotationY).toBe(45);
  });

  it("rejects rotationY above 360", async () => {
    const dto = plainToInstance(CreateCameraDto, { ...base, rotationY: 361 });
    expect((await errs(dto)).some((m) => /rotationY/.test(m))).toBe(true);
  });

  it("rejects a fov below 30", async () => {
    const dto = plainToInstance(CreateCameraDto, { ...base, fov: 10 });
    expect((await errs(dto)).some((m) => /fov/.test(m))).toBe(true);
  });

  it("rejects an out-of-enum streamType", async () => {
    const dto = plainToInstance(CreateCameraDto, {
      ...base,
      streamType: "MJPEG",
    });
    expect((await errs(dto)).some((m) => /streamType/.test(m))).toBe(true);
  });
});

describe("DateRangeDto / HeatmapQueryDto", () => {
  it("accepts ISO dates and a valid granularity", async () => {
    const dto = plainToInstance(HeatmapQueryDto, {
      startDate: "2026-01-01T00:00:00Z",
      granularity: HeatmapGranularity.DAILY,
    });
    expect(await errs(dto)).toEqual([]);
  });

  it("rejects an out-of-enum granularity", async () => {
    const dto = plainToInstance(HeatmapQueryDto, { granularity: "YEARLY" });
    expect((await errs(dto)).some((m) => /granularity/.test(m))).toBe(true);
  });

  it("rejects a non-ISO startDate", async () => {
    const dto = plainToInstance(DateRangeDto, { startDate: "soon" });
    expect((await errs(dto)).length).toBeGreaterThan(0);
  });
});

describe("Insight DTOs", () => {
  it("UpdateInsightStatusDto requires a valid status enum", async () => {
    expect(
      await errs(
        plainToInstance(UpdateInsightStatusDto, {
          status: InsightStatus.REVIEWED,
        }),
      ),
    ).toEqual([]);
    const bad = plainToInstance(UpdateInsightStatusDto, { status: "MAYBE" });
    expect((await errs(bad)).some((m) => /status/.test(m))).toBe(true);
  });

  it("InsightFilterDto clamps the limit to [1,100]", async () => {
    const dto = plainToInstance(InsightFilterDto, { limit: 500 });
    expect((await errs(dto)).some((m) => /limit/.test(m))).toBe(true);
  });
});
