import { DeliveryWebhookController } from "./delivery-webhook.controller";
import { DeliveryConfigService } from "../services/delivery-config.service";
import { DeliveryOrderService } from "../services/delivery-order.service";
import { DeliveryLogService } from "../services/delivery-log.service";
import { AdapterFactory } from "../adapters/adapter-factory";
import { DeliveryPlatform } from "../constants/platform.enum";

/**
 * Long-tail spec for the public delivery webhook controller (the
 * Yemeksepeti new-order path). Load-bearing contracts: an unconfigured
 * restaurant id is IGNORED (not 500 — a webhook for a restaurant we don't
 * serve must not error); a valid order is parsed by the adapter and routed
 * to processIncomingOrder under the resolved tenantId; a duplicate is
 * acknowledged without re-processing.
 */
describe("DeliveryWebhookController (yemeksepeti)", () => {
  let configService: { findByRemoteRestaurantId: jest.Mock };
  let orderService: {
    processIncomingOrder: jest.Mock;
    applyPlatformStatusUpdate: jest.Mock;
    applyPlatformRefund: jest.Mock;
    applyPlatformAmendment: jest.Mock;
  };
  let logService: Record<string, jest.Mock>;
  let adapterFactory: { getAdapter: jest.Mock };
  let parseWebhookOrder: jest.Mock;
  let ctrl: DeliveryWebhookController;

  beforeEach(() => {
    parseWebhookOrder = jest.fn().mockReturnValue({ externalId: "ext-1" });
    configService = {
      findByRemoteRestaurantId: jest
        .fn()
        .mockResolvedValue({ tenantId: "t1" }),
    };
    orderService = {
      processIncomingOrder: jest.fn().mockResolvedValue({ id: "ord-1" }),
      applyPlatformStatusUpdate: jest
        .fn()
        .mockResolvedValue({ matched: true, mappedTo: "CANCELLED" }),
      applyPlatformRefund: jest
        .fn()
        .mockResolvedValue({ matched: true, applied: true, type: "full" }),
      applyPlatformAmendment: jest
        .fn()
        .mockResolvedValue({ matched: true, applied: true }),
    };
    logService = {
      log: jest.fn().mockResolvedValue(undefined),
      scrubPii: jest.fn((x: any) => x),
    };
    adapterFactory = {
      getAdapter: jest.fn().mockReturnValue({ parseWebhookOrder }),
    };
    ctrl = new DeliveryWebhookController(
      configService as unknown as DeliveryConfigService,
      orderService as unknown as DeliveryOrderService,
      logService as unknown as DeliveryLogService,
      adapterFactory as unknown as AdapterFactory,
    );
  });

  it("ignores a webhook for an unconfigured restaurant (no throw)", async () => {
    configService.findByRemoteRestaurantId.mockResolvedValue(null);
    const out = await ctrl.yemeksepetiNewOrder("r-unknown", {});
    expect(out).toMatchObject({ status: "ignored" });
    expect(orderService.processIncomingOrder).not.toHaveBeenCalled();
  });

  it("parses the order and routes it to the resolved tenant", async () => {
    await ctrl.yemeksepetiNewOrder("r-1", { foo: "bar" });
    expect(adapterFactory.getAdapter).toHaveBeenCalledWith(
      DeliveryPlatform.YEMEKSEPETI,
    );
    expect(parseWebhookOrder).toHaveBeenCalledWith({ foo: "bar" });
    expect(orderService.processIncomingOrder).toHaveBeenCalledWith(
      "t1",
      { externalId: "ext-1" },
    );
  });

  it("acknowledges a duplicate order without re-processing downstream", async () => {
    orderService.processIncomingOrder.mockResolvedValue(null);
    const out = await ctrl.yemeksepetiNewOrder("r-1", {});
    expect(out).toMatchObject({ status: "ok" });
  });

  describe("trendyol status/cancellation route", () => {
    it("ignores a status webhook for an unconfigured restaurant (no throw)", async () => {
      configService.findByRemoteRestaurantId.mockResolvedValue(null);
      const out = await ctrl.trendyolStatusUpdate("r-unknown", "ext-9", {
        status: "CANCELLED",
      });
      expect(out).toMatchObject({ status: "ignored" });
      expect(orderService.applyPlatformStatusUpdate).not.toHaveBeenCalled();
    });

    it("routes a platform cancellation to applyPlatformStatusUpdate (inbound only)", async () => {
      const out = await ctrl.trendyolStatusUpdate("r-1", "ext-9", {
        status: "CANCELLED",
      });

      expect(orderService.applyPlatformStatusUpdate).toHaveBeenCalledWith({
        platform: DeliveryPlatform.TRENDYOL,
        remoteOrderId: "ext-9",
        tenantId: "t1",
        platformStatus: "CANCELLED",
      });
      expect(out).toMatchObject({ status: "ok", matched: true });
      // Inbound only — the controller must not parse/process a new order.
      expect(orderService.processIncomingOrder).not.toHaveBeenCalled();
    });
  });

  describe("refund route (inbound only)", () => {
    it("ignores a refund webhook for an unconfigured restaurant", async () => {
      configService.findByRemoteRestaurantId.mockResolvedValue(null);
      const out = await ctrl.trendyolRefund("r-unknown", "ext-9", {
        refundAmount: 30,
      });
      expect(out).toMatchObject({ status: "ignored" });
      expect(orderService.applyPlatformRefund).not.toHaveBeenCalled();
    });

    it("extracts amount/reason/refundId and routes to applyPlatformRefund (no order push-back)", async () => {
      orderService.applyPlatformRefund.mockResolvedValue({
        matched: true,
        applied: true,
        type: "partial",
        duplicate: false,
      });

      const out = await ctrl.trendyolRefund("r-1", "ext-9", {
        refundAmount: 30,
        reason: "customer complaint",
        refundId: "rf-1",
      });

      expect(orderService.applyPlatformRefund).toHaveBeenCalledWith({
        platform: DeliveryPlatform.TRENDYOL,
        remoteOrderId: "ext-9",
        tenantId: "t1",
        refundAmount: 30,
        reason: "customer complaint",
        refundId: "rf-1",
      });
      expect(out).toMatchObject({ status: "ok", applied: true, type: "partial" });
      // Refund is inbound — never starts a new order.
      expect(orderService.processIncomingOrder).not.toHaveBeenCalled();
    });

    it("treats a missing amount as a full refund (null amount)", async () => {
      await ctrl.yemeksepetiRefund("r-1", "ext-9", { reason: "fraud" });
      expect(orderService.applyPlatformRefund).toHaveBeenCalledWith(
        expect.objectContaining({ refundAmount: null }),
      );
    });
  });

  describe("amendment route", () => {
    it("ignores an amendment for an unconfigured restaurant", async () => {
      configService.findByRemoteRestaurantId.mockResolvedValue(null);
      const out = await ctrl.trendyolAmend("r-unknown", "ext-9", {});
      expect(out).toMatchObject({ status: "ignored" });
      expect(orderService.applyPlatformAmendment).not.toHaveBeenCalled();
    });

    it("parses the amended cart and routes it to applyPlatformAmendment", async () => {
      const out = await ctrl.trendyolAmend("r-1", "ext-9", { foo: "bar" });
      expect(parseWebhookOrder).toHaveBeenCalledWith({ foo: "bar" });
      expect(orderService.applyPlatformAmendment).toHaveBeenCalledWith("t1", {
        externalId: "ext-1",
      });
      expect(out).toMatchObject({ status: "ok", applied: true });
    });

    it("surfaces a refused amendment (committed order) without throwing", async () => {
      orderService.applyPlatformAmendment.mockResolvedValue({
        matched: true,
        applied: false,
        refused: true,
        reason: "order is SERVED — too late to amend",
      });
      const out = await ctrl.trendyolAmend("r-1", "ext-9", {});
      expect(out).toMatchObject({ status: "ok", applied: false, refused: true });
    });
  });
});
