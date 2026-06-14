import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  EdgeDeviceRegisterDto,
  DetectionDto,
  EdgeOccupancyDataDto,
} from "./edge-device.dto";
import { PersonState } from "../../enums/analytics.enum";

/**
 * Long-tail validation spec for the edge-device ingest DTOs. These accept
 * payloads from on-prem CV boxes, so the bounds are load-bearing: grid
 * coords clamp to a 20x20 floor cell index [0,19], confidence is a [0,1]
 * probability, state is a closed enum, and the occupancy envelope nests +
 * validates each detection.
 */
async function errs(dto: object): Promise<string[]> {
  const results = await validate(dto);
  return results.flatMap((e) => Object.values(e.constraints ?? {}));
}

const validDetection = {
  trackingId: "trk-1",
  positionX: 1.5,
  positionZ: 2.5,
  gridX: 5,
  gridZ: 10,
  state: PersonState.SITTING,
  confidence: 0.92,
};

describe("EdgeDeviceRegisterDto", () => {
  it("accepts a valid registration", async () => {
    const dto = plainToInstance(EdgeDeviceRegisterDto, {
      deviceId: "d1",
      tenantId: "t1",
      cameraId: "c1",
      timestamp: "2026-06-15T00:00:00Z",
    });
    expect(await errs(dto)).toEqual([]);
  });

  it("rejects a non-ISO timestamp", async () => {
    const dto = plainToInstance(EdgeDeviceRegisterDto, {
      deviceId: "d1",
      tenantId: "t1",
      cameraId: "c1",
      timestamp: "now",
    });
    expect((await errs(dto)).some((m) => /timestamp/.test(m))).toBe(true);
  });
});

describe("DetectionDto", () => {
  it("accepts a valid detection", async () => {
    expect(await errs(plainToInstance(DetectionDto, validDetection))).toEqual([]);
  });

  it("rejects a grid index above 19 (floor-cell out of bounds)", async () => {
    const dto = plainToInstance(DetectionDto, { ...validDetection, gridX: 20 });
    expect((await errs(dto)).some((m) => /gridX/.test(m))).toBe(true);
  });

  it("rejects a confidence above 1 (not a probability)", async () => {
    const dto = plainToInstance(DetectionDto, {
      ...validDetection,
      confidence: 1.5,
    });
    expect((await errs(dto)).some((m) => /confidence/.test(m))).toBe(true);
  });

  it("rejects an unknown person state", async () => {
    const dto = plainToInstance(DetectionDto, {
      ...validDetection,
      state: "DANCING",
    });
    expect((await errs(dto)).some((m) => /state/.test(m))).toBe(true);
  });
});

describe("EdgeOccupancyDataDto", () => {
  it("validates each nested detection", async () => {
    const dto = plainToInstance(EdgeOccupancyDataDto, {
      cameraId: "c1",
      tenantId: "t1",
      timestamp: "2026-06-15T00:00:00Z",
      detections: [{ ...validDetection, confidence: 5 }], // bad nested
    });
    expect((await errs(dto)).length + (await validate(dto)).length).toBeGreaterThan(
      0,
    );
  });

  it("accepts a well-formed occupancy envelope", async () => {
    const dto = plainToInstance(EdgeOccupancyDataDto, {
      cameraId: "c1",
      tenantId: "t1",
      timestamp: "2026-06-15T00:00:00Z",
      detections: [validDetection],
    });
    expect(await errs(dto)).toEqual([]);
  });
});
