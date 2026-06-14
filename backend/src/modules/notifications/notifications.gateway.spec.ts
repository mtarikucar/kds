import { JwtService } from "@nestjs/jwt";
import { Socket } from "socket.io";
import { NotificationsGateway } from "./notifications.gateway";
import { BranchGuard } from "../auth/guards/branch.guard";

/**
 * Long-tail spec for the notifications WS gateway. The connection handler is
 * the security boundary; load-bearing contracts:
 *  - no token → disconnect
 *  - non-"user" realm token (marketing/superadmin) → disconnect
 *  - missing handshake branchId → disconnect
 *  - branchId the role can't access → disconnect (WS mirrors BranchGuard)
 *  - valid token+branch → join user / branch / tenant rooms
 * Plus the three emit helpers route to the right rooms.
 */
describe("NotificationsGateway", () => {
  function makeSocket(over: Partial<Socket["handshake"]> = {}): Socket & {
    disconnect: jest.Mock;
    join: jest.Mock;
    data: Record<string, unknown>;
  } {
    return {
      id: "sock-1",
      connected: true,
      data: {},
      handshake: { auth: {}, headers: {}, ...over },
      disconnect: jest.fn(),
      join: jest.fn(),
    } as unknown as Socket & {
      disconnect: jest.Mock;
      join: jest.Mock;
      data: Record<string, unknown>;
    };
  }

  function gatewayWithPayload(payload: unknown) {
    const jwt = { verify: jest.fn().mockReturnValue(payload) } as unknown as JwtService;
    return new NotificationsGateway(jwt);
  }

  it("disconnects when no token is supplied", async () => {
    const gw = gatewayWithPayload({});
    const sock = makeSocket({ auth: {}, headers: {} });
    await gw.handleConnection(sock);
    expect(sock.disconnect).toHaveBeenCalled();
    expect(sock.join).not.toHaveBeenCalled();
  });

  it("disconnects a non-user realm token (marketing/superadmin)", async () => {
    const gw = gatewayWithPayload({ type: "superadmin", sub: "u1", tenantId: "t1" });
    const sock = makeSocket({ auth: { token: "x", branchId: "b1" } });
    await gw.handleConnection(sock);
    expect(sock.disconnect).toHaveBeenCalled();
  });

  it("disconnects when the handshake carries no branchId", async () => {
    const gw = gatewayWithPayload({ sub: "u1", tenantId: "t1", role: "ADMIN" });
    const sock = makeSocket({ auth: { token: "x" } });
    await gw.handleConnection(sock);
    expect(sock.disconnect).toHaveBeenCalled();
  });

  it("disconnects when the role cannot access the requested branch", async () => {
    jest.spyOn(BranchGuard, "canAccessBranchStatic").mockReturnValue(false);
    const gw = gatewayWithPayload({
      sub: "u1",
      tenantId: "t1",
      role: "WAITER",
      primaryBranchId: "b-allowed",
    });
    const sock = makeSocket({ auth: { token: "x", branchId: "b-other" } });
    await gw.handleConnection(sock);
    expect(sock.disconnect).toHaveBeenCalled();
    (BranchGuard.canAccessBranchStatic as jest.Mock).mockRestore();
  });

  it("joins user / branch / tenant rooms for a valid user token", async () => {
    jest.spyOn(BranchGuard, "canAccessBranchStatic").mockReturnValue(true);
    const gw = gatewayWithPayload({
      sub: "u1",
      tenantId: "t1",
      role: "ADMIN",
    });
    const sock = makeSocket({ auth: { token: "x", branchId: "b1" } });
    await gw.handleConnection(sock);
    expect(sock.disconnect).not.toHaveBeenCalled();
    expect(sock.join).toHaveBeenCalledWith("user:u1");
    expect(sock.join).toHaveBeenCalledWith("tenant:t1:branch:b1");
    expect(sock.join).toHaveBeenCalledWith("tenant:t1");
    expect(sock.data.userId).toBe("u1");
    (BranchGuard.canAccessBranchStatic as jest.Mock).mockRestore();
  });

  describe("emit helpers route to the right rooms", () => {
    function gatewayWithServer() {
      const emit = jest.fn();
      const to = jest.fn().mockReturnValue({ emit });
      const gw = new NotificationsGateway({} as JwtService);
      (gw as unknown as { server: unknown }).server = { to };
      return { gw, to, emit };
    }

    it("sendNotificationToUser targets the user room", () => {
      const { gw, to } = gatewayWithServer();
      gw.sendNotificationToUser("u9", { title: "Hi" });
      expect(to).toHaveBeenCalledWith("user:u9");
    });

    it("sendNotificationToBranch targets the (tenant,branch) room", () => {
      const { gw, to } = gatewayWithServer();
      gw.sendNotificationToBranch("t1", "b1", { title: "Stock low" });
      expect(to).toHaveBeenCalledWith("tenant:t1:branch:b1");
    });

    it("broadcastToTenantAcrossBranches targets the bare tenant room", () => {
      const { gw, to } = gatewayWithServer();
      gw.broadcastToTenantAcrossBranches("t1", { title: "Billing" });
      expect(to).toHaveBeenCalledWith("tenant:t1");
    });
  });
});
