import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateReleaseDto } from "./create-release.dto";
import { UpdateReleaseDto } from "./update-release.dto";

/**
 * Long-tail validation spec for the desktop-app release DTOs. Load-bearing
 * rules: version must be strict semver (it drives the Tauri auto-updater's
 * "newer than installed?" compare); platform installer URLs must be valid
 * URLs; published coerces from a string boolean; empty-string optionals
 * coerce away. UpdateReleaseDto is the partial.
 */
async function errs(dto: object): Promise<string[]> {
  const results = await validate(dto);
  return results.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe("CreateReleaseDto", () => {
  const base = {
    version: "0.2.6",
    releaseTag: "v0.2.6",
    releaseNotes: "## Notes",
  };

  it("accepts a valid release", async () => {
    expect(await errs(plainToInstance(CreateReleaseDto, base))).toEqual([]);
  });

  it("rejects a non-semver version", async () => {
    const dto = plainToInstance(CreateReleaseDto, { ...base, version: "0.2" });
    expect((await errs(dto)).some((m) => /version/.test(m))).toBe(true);
  });

  it("rejects a malformed installer URL", async () => {
    const dto = plainToInstance(CreateReleaseDto, {
      ...base,
      windowsUrl: "not a url",
    });
    expect((await errs(dto)).some((m) => /windowsUrl/.test(m))).toBe(true);
  });

  it("coerces a string-boolean published and empty-string URLs away", async () => {
    const dto = plainToInstance(CreateReleaseDto, {
      ...base,
      published: "true",
      macArmUrl: "",
    });
    expect(await errs(dto)).toEqual([]);
    expect(dto.published).toBe(true);
    expect(dto.macArmUrl).toBeUndefined();
  });
});

describe("UpdateReleaseDto", () => {
  it("accepts a partial patch but still validates provided fields", async () => {
    expect(await errs(plainToInstance(UpdateReleaseDto, {}))).toEqual([]);
    const bad = plainToInstance(UpdateReleaseDto, { version: "x.y" });
    expect((await errs(bad)).some((m) => /version/.test(m))).toBe(true);
  });
});
