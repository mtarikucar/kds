import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  CreateNotificationDto,
  NotificationType,
  NotificationPriority,
} from "./create-notification.dto";

/**
 * Long-tail validation spec for CreateNotificationDto. Load-bearing rules:
 * title/message length caps (defence vs blasted blobs), type is a closed
 * enum, tenantId is a UUID, isGlobal coerces from a string boolean, and the
 * expiry coerces empty string away.
 */
async function errs(dto: object): Promise<string[]> {
  const results = await validate(dto);
  return results.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe("CreateNotificationDto", () => {
  const base = {
    title: "Code sent",
    message: "Your code: 123456",
    type: NotificationType.INFO,
    tenantId: "0c4612e8-18e6-4f16-9edd-844f9369edc7",
  };

  it("accepts a minimal valid notification", async () => {
    expect(await errs(plainToInstance(CreateNotificationDto, base))).toEqual([]);
  });

  it("rejects a non-UUID tenantId", async () => {
    const dto = plainToInstance(CreateNotificationDto, {
      ...base,
      tenantId: "tenant-1",
    });
    expect((await errs(dto)).some((m) => /tenantId/.test(m))).toBe(true);
  });

  it("rejects an out-of-enum type", async () => {
    const dto = plainToInstance(CreateNotificationDto, {
      ...base,
      type: "ANNOUNCEMENT",
    });
    expect((await errs(dto)).some((m) => /type/.test(m))).toBe(true);
  });

  it("caps the title at 200 chars", async () => {
    const dto = plainToInstance(CreateNotificationDto, {
      ...base,
      title: "x".repeat(201),
    });
    expect((await errs(dto)).some((m) => /title/.test(m))).toBe(true);
  });

  it("coerces a string-boolean isGlobal", async () => {
    const dto = plainToInstance(CreateNotificationDto, {
      ...base,
      isGlobal: "true",
    });
    expect(await errs(dto)).toEqual([]);
    expect(dto.isGlobal).toBe(true);
  });

  it("accepts a valid priority and coerces empty expiry away", async () => {
    const dto = plainToInstance(CreateNotificationDto, {
      ...base,
      priority: NotificationPriority.HIGH,
      expiresAt: "",
    });
    expect(await errs(dto)).toEqual([]);
    expect(dto.expiresAt).toBeUndefined();
  });
});
