import { paginated } from "./paginated-result";

/**
 * Long-tail spec for the pagination envelope builder. Load-bearing
 * contracts: meta is computed from total/limit, limit is floored to >= 1
 * (a 0/negative limit must not produce Infinity/NaN totalPages), and
 * totalPages is at least 1 even for an empty result.
 */
describe("paginated", () => {
  it("wraps data with computed meta for a normal page", () => {
    const r = paginated([1, 2, 3], 23, 1, 10);
    expect(r.data).toEqual([1, 2, 3]);
    expect(r.meta).toEqual({ total: 23, page: 1, limit: 10, totalPages: 3 });
  });

  it("floors a zero/negative limit to 1 (no Infinity totalPages)", () => {
    const r = paginated([], 5, 1, 0);
    expect(r.meta.limit).toBe(1);
    expect(r.meta.totalPages).toBe(5);
    expect(Number.isFinite(r.meta.totalPages)).toBe(true);
  });

  it("keeps totalPages at minimum 1 for an empty dataset", () => {
    const r = paginated([], 0, 1, 10);
    expect(r.meta.totalPages).toBe(1);
  });

  it("defaults page to 1 and limit to the data length", () => {
    const r = paginated([1, 2]);
    expect(r.meta.page).toBe(1);
    expect(r.meta.limit).toBe(2);
  });
});
