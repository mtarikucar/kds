import axios from "axios";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { MarketingEventRelayService } from "./marketing-event-relay.service";
import { EventTypes } from "./event-types";
import {
  INTERNAL_EVENTS_ROUTE,
  INTERNAL_TOKEN_HEADER,
} from "../../core-contracts/internal-http.contract";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

function configWith(env: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

const paymentEvent = {
  type: EventTypes.PaymentSucceeded,
  payload: { paymentId: "p-1" },
  idempotencyKey: "payment-succeeded:p-1",
  tenantId: "t-1",
};

describe("MarketingEventRelayService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("with MARKETING_SERVICE_URL configured", () => {
    let relay: MarketingEventRelayService;

    beforeEach(() => {
      relay = new MarketingEventRelayService(
        configWith({
          MARKETING_SERVICE_URL: "http://marketing:3100/",
          INTERNAL_SERVICE_TOKEN: "secret-token",
        }),
      );
    });

    it("POSTs the canonical events route, forwarding idempotencyKey and tenantId from the drained row", async () => {
      mockedAxios.post.mockResolvedValue({ status: 202 });

      await expect(relay.relay(paymentEvent)).resolves.toBe("relayed");

      expect(mockedAxios.post).toHaveBeenCalledWith(
        `http://marketing:3100/api/${INTERNAL_EVENTS_ROUTE}`,
        {
          type: EventTypes.PaymentSucceeded,
          payload: { paymentId: "p-1" },
          idempotencyKey: "payment-succeeded:p-1",
          tenantId: "t-1",
        },
        expect.objectContaining({
          headers: { [INTERNAL_TOKEN_HEADER]: "secret-token" },
        }),
      );
    });

    it("omits tenantId (undefined) for tenantless rows instead of sending null", async () => {
      mockedAxios.post.mockResolvedValue({ status: 202 });

      await relay.relay({ ...paymentEvent, tenantId: null });

      const body = mockedAxios.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body.tenantId).toBeUndefined();
    });

    it("skips non-marketing-bound event types without a network call", async () => {
      await expect(
        relay.relay({ ...paymentEvent, type: "order.created.v1" }),
      ).resolves.toBe("skipped-not-marketing");
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it("throws on a non-2xx response so the outbox retry machinery takes over", async () => {
      mockedAxios.post.mockResolvedValue({ status: 401 });

      await expect(relay.relay(paymentEvent)).rejects.toThrow(
        /rejected payment\.succeeded\.v1 with status 401/,
      );
    });
  });

  describe("with MARKETING_SERVICE_URL unset", () => {
    let relay: MarketingEventRelayService;

    beforeEach(() => {
      relay = new MarketingEventRelayService(configWith({}));
    });

    it("reports skipped-unconfigured for marketing-bound events (worker parks the row)", async () => {
      await expect(relay.relay(paymentEvent)).resolves.toBe(
        "skipped-unconfigured",
      );
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it("still reports skipped-not-marketing for core-local events", async () => {
      await expect(
        relay.relay({ ...paymentEvent, type: "order.created.v1" }),
      ).resolves.toBe("skipped-not-marketing");
    });
  });

  describe("startup configuration logging", () => {
    it("logs a loud error when the URL is set but INTERNAL_SERVICE_TOKEN is missing", () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation(() => undefined);

      const relay = new MarketingEventRelayService(
        configWith({ MARKETING_SERVICE_URL: "http://marketing:3100" }),
      );
      relay.onModuleInit();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringMatching(
          /MARKETING_SERVICE_URL is set but INTERNAL_SERVICE_TOKEN is unset\/empty/,
        ),
      );
      errorSpy.mockRestore();
    });

    it("logs the same loud error for an empty/whitespace token", () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation(() => undefined);

      const relay = new MarketingEventRelayService(
        configWith({
          MARKETING_SERVICE_URL: "http://marketing:3100",
          INTERNAL_SERVICE_TOKEN: "   ",
        }),
      );
      relay.onModuleInit();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("INTERNAL_SERVICE_TOKEN"),
      );
      errorSpy.mockRestore();
    });

    it("does not log the token error when both vars are set", () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation(() => undefined);

      const relay = new MarketingEventRelayService(
        configWith({
          MARKETING_SERVICE_URL: "http://marketing:3100",
          INTERNAL_SERVICE_TOKEN: "secret-token",
        }),
      );
      relay.onModuleInit();

      expect(errorSpy).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });
});
