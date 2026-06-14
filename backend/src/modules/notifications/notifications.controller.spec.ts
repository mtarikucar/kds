import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

/**
 * Long-tail forwarding spec for NotificationsController. Load-bearing
 * contracts: every endpoint is scoped to the authed user's tenantId+userId
 * (the @CurrentUser-extracted values) so one user can't read or ack
 * another's feed.
 */
describe("NotificationsController", () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: NotificationsController;

  beforeEach(() => {
    svc = {
      findAll: jest.fn().mockResolvedValue([]),
      markAsRead: jest.fn().mockResolvedValue({}),
      markAllAsRead: jest.fn().mockResolvedValue({}),
    };
    ctrl = new NotificationsController(svc as unknown as NotificationsService);
  });

  it("findAll forwards tenantId + userId", () => {
    ctrl.findAll("t1", "u1");
    expect(svc.findAll).toHaveBeenCalledWith("t1", "u1");
  });

  it("markAsRead threads id, userId and tenantId", () => {
    ctrl.markAsRead("n1", "u1", "t1");
    expect(svc.markAsRead).toHaveBeenCalledWith("n1", "u1", "t1");
  });

  it("markAllAsRead forwards tenantId + userId", () => {
    ctrl.markAllAsRead("t1", "u1");
    expect(svc.markAllAsRead).toHaveBeenCalledWith("t1", "u1");
  });
});
