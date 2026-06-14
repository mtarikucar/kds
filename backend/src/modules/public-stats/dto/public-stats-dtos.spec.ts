import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { TrackViewDto } from "./track-view.dto";
import { CreateReviewDto } from "./create-review.dto";

/**
 * Long-tail validation spec for the public (unauthenticated) DTOs. These
 * surfaces accept anonymous input so the caps are load-bearing: page/path
 * length limits, review rating bounded to 1–5, email format, and a 10–2000
 * char comment to keep spam/blobs out of the platform reviews table.
 */
async function errs(dto: object): Promise<string[]> {
  const results = await validate(dto);
  return results.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe("TrackViewDto", () => {
  it("accepts a minimal page+path", async () => {
    expect(
      await errs(plainToInstance(TrackViewDto, { page: "landing", path: "/" })),
    ).toEqual([]);
  });

  it("requires page and path", async () => {
    const msgs = await errs(plainToInstance(TrackViewDto, {}));
    expect(msgs.some((m) => /page/.test(m))).toBe(true);
    expect(msgs.some((m) => /path/.test(m))).toBe(true);
  });

  it("caps path length at 500 chars", async () => {
    const dto = plainToInstance(TrackViewDto, {
      page: "x",
      path: "/" + "a".repeat(500),
    });
    expect((await errs(dto)).some((m) => /path/.test(m))).toBe(true);
  });
});

describe("CreateReviewDto", () => {
  const base = {
    name: "John Doe",
    email: "john@example.com",
    rating: 5,
    comment: "Great service and food!",
  };

  it("accepts a valid review", async () => {
    expect(await errs(plainToInstance(CreateReviewDto, base))).toEqual([]);
  });

  it("rejects an invalid email", async () => {
    const dto = plainToInstance(CreateReviewDto, { ...base, email: "nope" });
    expect((await errs(dto)).some((m) => /email/.test(m))).toBe(true);
  });

  it("rejects a rating outside 1–5", async () => {
    expect(
      (await errs(plainToInstance(CreateReviewDto, { ...base, rating: 6 }))).some(
        (m) => /rating/.test(m),
      ),
    ).toBe(true);
    expect(
      (await errs(plainToInstance(CreateReviewDto, { ...base, rating: 0 }))).some(
        (m) => /rating/.test(m),
      ),
    ).toBe(true);
  });

  it("rejects a too-short comment (spam guard)", async () => {
    const dto = plainToInstance(CreateReviewDto, { ...base, comment: "ok" });
    expect((await errs(dto)).some((m) => /comment/.test(m))).toBe(true);
  });

  it("rejects a too-long comment blob", async () => {
    const dto = plainToInstance(CreateReviewDto, {
      ...base,
      comment: "x".repeat(2001),
    });
    expect((await errs(dto)).some((m) => /comment/.test(m))).toBe(true);
  });
});
