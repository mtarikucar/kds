import { isUnlimited } from "./subscription-plans.const";

/**
 * The static plan catalogue this file used to cover was retired with the
 * à-la-carte migration series (see the const file's header). What remains is
 * the -1 sentinel helper, which entitlement limit values still lean on: a
 * limit of 0 is a real cap of zero, not "unlimited", so only -1 may pass.
 */
describe("subscription-plans.const", () => {
  it("isUnlimited treats only the -1 sentinel as unlimited", () => {
    expect(isUnlimited(-1)).toBe(true);
    expect(isUnlimited(0)).toBe(false);
    expect(isUnlimited(1)).toBe(false);
    expect(isUnlimited(100)).toBe(false);
  });

  it("does not treat other negative values as unlimited", () => {
    expect(isUnlimited(-2)).toBe(false);
    expect(isUnlimited(-100)).toBe(false);
  });
});
