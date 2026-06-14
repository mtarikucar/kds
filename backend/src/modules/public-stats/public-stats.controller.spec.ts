import { PublicStatsController } from "./public-stats.controller";
import { PublicStatsService } from "./public-stats.service";

/**
 * Long-tail spec for the public stats controller. Load-bearing contracts:
 * trackView is fire-and-forget (it returns {success:true} immediately and
 * swallows service rejections so a logging failure never 500s a page view);
 * getStats null-coalesces the country/city distributions to {}; getReviews
 * clamps the limit to a max of 50; submitReview returns the moderation
 * envelope with the new review id.
 */
describe("PublicStatsController", () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: PublicStatsController;

  beforeEach(() => {
    svc = {
      trackPageView: jest.fn().mockResolvedValue(undefined),
      getPublicStats: jest.fn().mockResolvedValue({ totalViews: 5 }),
      submitReview: jest.fn().mockResolvedValue({ id: "rev-1" }),
      getApprovedReviews: jest.fn().mockResolvedValue([]),
      getPendingReviews: jest.fn().mockResolvedValue([]),
      approveReview: jest.fn().mockResolvedValue({}),
      rejectReview: jest.fn().mockResolvedValue({}),
    };
    ctrl = new PublicStatsController(svc as unknown as PublicStatsService);
  });

  it("trackView returns success immediately and forwards ip + user-agent", async () => {
    const dto = { page: "landing", path: "/" } as any;
    const out = await ctrl.trackView(dto, "1.2.3.4", "agent");
    expect(out).toEqual({ success: true });
    expect(svc.trackPageView).toHaveBeenCalledWith(dto, "1.2.3.4", "agent");
  });

  it("trackView swallows a service rejection (fire-and-forget)", async () => {
    svc.trackPageView.mockRejectedValue(new Error("db down"));
    await expect(
      ctrl.trackView({ page: "p", path: "/" } as any, "1.2.3.4", ""),
    ).resolves.toEqual({ success: true });
  });

  it("getStats null-coalesces missing distributions to {}", async () => {
    svc.getPublicStats.mockResolvedValue({ totalViews: 5 });
    const out = await ctrl.getStats();
    expect(out.countryDistribution).toEqual({});
    expect(out.cityDistribution).toEqual({});
    expect(out.totalViews).toBe(5);
  });

  it("getReviews clamps the requested limit to a max of 50", async () => {
    await ctrl.getReviews(1000);
    expect(svc.getApprovedReviews).toHaveBeenCalledWith(50);
  });

  it("submitReview returns the moderation envelope with the new id", async () => {
    const out = await ctrl.submitReview({ rating: 5 } as any, "1.2.3.4");
    expect(svc.submitReview).toHaveBeenCalledWith({ rating: 5 }, "1.2.3.4");
    expect(out).toMatchObject({ success: true, reviewId: "rev-1" });
  });

  it("admin moderation endpoints forward the review id", async () => {
    await ctrl.approveReview("r1");
    await ctrl.rejectReview("r2");
    expect(svc.approveReview).toHaveBeenCalledWith("r1");
    expect(svc.rejectReview).toHaveBeenCalledWith("r2");
  });
});
