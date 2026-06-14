import { WebhooksOutboundController } from "./webhooks-outbound.controller";
import { WebhookOutboundService } from "./webhook-outbound.service";

/**
 * Long-tail forwarding spec for WebhooksOutboundController. Outbound
 * webhooks emit tenant data to arbitrary URLs (ADMIN + API_ACCESS gated);
 * the load-bearing contract here is that every operation is scoped to
 * req.user.tenantId so one tenant can't list/revoke another's subscriptions.
 */
describe("WebhooksOutboundController", () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: WebhooksOutboundController;
  const req = { user: { tenantId: "t1" } };

  beforeEach(() => {
    svc = {
      list: jest.fn().mockResolvedValue([]),
      subscribe: jest.fn().mockResolvedValue({}),
      revoke: jest.fn().mockResolvedValue({}),
    };
    ctrl = new WebhooksOutboundController(
      svc as unknown as WebhookOutboundService,
    );
  });

  it("list is tenant-scoped", () => {
    ctrl.list(req);
    expect(svc.list).toHaveBeenCalledWith("t1");
  });

  it("subscribe forwards tenantId + body", () => {
    const body = { url: "https://x/hook", events: ["order.created"] };
    ctrl.subscribe(req, body);
    expect(svc.subscribe).toHaveBeenCalledWith("t1", body);
  });

  it("revoke is tenant-scoped", () => {
    ctrl.revoke(req, "sub-1");
    expect(svc.revoke).toHaveBeenCalledWith("t1", "sub-1");
  });
});
