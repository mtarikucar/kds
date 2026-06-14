import { Request } from "express";
import { RawBodyRequest } from "@nestjs/common";
import { IntegrationController } from "./integration.controller";
import { IntegrationService } from "./integration.service";

/**
 * Long-tail forwarding spec for IntegrationController. Load-bearing
 * contracts: provider listing filters by ?kind; connect/disconnect are
 * tenant-scoped (credential writes were locked to ADMIN/MANAGER); and the
 * public webhook falls back to a JSON-serialized body buffer when the raw
 * body is absent (so an adapter always receives bytes to HMAC-verify).
 */
describe("IntegrationController", () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: IntegrationController;
  const req = { user: { tenantId: "t1" } } as any;

  beforeEach(() => {
    svc = {
      listProviders: jest.fn().mockResolvedValue([]),
      connect: jest.fn().mockResolvedValue({}),
      listMyConnections: jest.fn().mockResolvedValue([]),
      disconnect: jest.fn().mockResolvedValue({}),
      ingestWebhook: jest.fn().mockResolvedValue({}),
    };
    ctrl = new IntegrationController(svc as unknown as IntegrationService);
  });

  it("list forwards the ?kind filter", () => {
    ctrl.list("delivery");
    expect(svc.listProviders).toHaveBeenCalledWith("delivery");
  });

  it("connect threads the tenantId and the body", () => {
    const body = { providerId: "getir", credentials: { x: 1 } };
    ctrl.connect(req, body);
    expect(svc.connect).toHaveBeenCalledWith("t1", body);
  });

  it("disconnect is tenant-scoped", () => {
    ctrl.disconnect(req, "conn-1");
    expect(svc.disconnect).toHaveBeenCalledWith("t1", "conn-1");
  });

  it("webhook forwards the raw body buffer when present", () => {
    const raw = Buffer.from("payload");
    const wreq = {
      rawBody: raw,
      headers: { "x-sig": "abc" },
      body: {},
    } as unknown as RawBodyRequest<Request>;
    ctrl.webhook("getir", "t1", wreq);
    expect(svc.ingestWebhook).toHaveBeenCalledWith(
      "getir",
      "t1",
      { "x-sig": "abc" },
      raw,
    );
  });

  it("webhook falls back to a JSON-serialized body buffer when rawBody is absent", () => {
    const wreq = {
      headers: {},
      body: { hello: "world" },
    } as unknown as RawBodyRequest<Request>;
    ctrl.webhook("getir", "t1", wreq);
    const passedBuffer = svc.ingestWebhook.mock.calls[0][3] as Buffer;
    expect(passedBuffer.toString()).toBe(JSON.stringify({ hello: "world" }));
  });
});
