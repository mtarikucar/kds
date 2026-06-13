import { PublicStatsService } from "./public-stats.service";

/**
 * Stored-XSS defense-in-depth: review name/restaurant/comment are public,
 * display-only text (moderation UI + public site). HTML markup is stripped on
 * store so a `<script>`/`<img onerror>` payload can never reach a renderer.
 */
describe("PublicStatsService.submitReview sanitization", () => {
  function build() {
    const create = jest.fn().mockImplementation(({ data }: any) => Promise.resolve(data));
    const prisma: any = { publicReview: { create } };
    const geo: any = { lookup: jest.fn().mockResolvedValue({ country: "TR", city: "Istanbul" }) };
    return { svc: new PublicStatsService(prisma, geo), create };
  }

  it("strips HTML tags from name, restaurant and comment", async () => {
    const { svc, create } = build();
    await svc.submitReview(
      {
        name: 'Eve <script>alert(1)</script>',
        email: "eve@example.com",
        restaurant: "<b>Bistro</b>",
        rating: 5,
        comment: 'Great! <img src=x onerror=alert(document.cookie)>',
      } as any,
      "1.2.3.4",
    );
    const data = create.mock.calls[0][0].data;
    expect(data.name).toBe("Eve");
    expect(data.restaurant).toBe("Bistro");
    expect(data.comment).toBe("Great!");
    expect(JSON.stringify(data)).not.toMatch(/<script|onerror|<img/i);
  });

  it("preserves legitimate punctuation (apostrophes, ampersands)", async () => {
    const { svc, create } = build();
    await svc.submitReview(
      { name: "O'Brien", restaurant: "Smith & Sons", rating: 4, comment: "5/5 — loved it" } as any,
      "1.2.3.4",
    );
    const data = create.mock.calls[0][0].data;
    expect(data.name).toBe("O'Brien");
    expect(data.restaurant).toBe("Smith & Sons");
    expect(data.comment).toBe("5/5 — loved it");
  });
});
