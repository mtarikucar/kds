import { HttpStatus } from "@nestjs/common";
import {
  PaymentFailedException,
  PaymentProcessingException,
  InvalidPaymentMethodException,
  OrderAlreadyPaidException,
} from "./payment.exception";
import { ErrorCode } from "../interfaces/error-response.interface";

/**
 * Long-tail spec for the payment exception family. Load-bearing contracts:
 * correct status + ErrorCode and optional reason interpolation so the
 * client/storefront can distinguish a hard failure from a processing error.
 */
describe("payment.exception family", () => {
  it("PaymentFailedException → 402 with optional reason", () => {
    const withReason = new PaymentFailedException("declined", { code: 51 });
    expect(withReason.getStatus()).toBe(HttpStatus.PAYMENT_REQUIRED);
    expect(withReason.errorCode).toBe(ErrorCode.PAYMENT_FAILED);
    expect(withReason.message).toContain("declined");
    expect(withReason.details).toEqual({ code: 51 });

    expect(new PaymentFailedException().message).toBe("Payment failed");
  });

  it("PaymentProcessingException → 400", () => {
    const ex = new PaymentProcessingException("gateway timeout");
    expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(ex.errorCode).toBe(ErrorCode.PAYMENT_PROCESSING_ERROR);
  });

  it("InvalidPaymentMethodException → 400 with optional method", () => {
    expect(new InvalidPaymentMethodException("bitcoin").message).toContain(
      "bitcoin",
    );
    expect(new InvalidPaymentMethodException().message).toBe(
      "Invalid payment method",
    );
  });

  it("OrderAlreadyPaidException → 400 with orderId in details", () => {
    const ex = new OrderAlreadyPaidException("o-1");
    expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(ex.errorCode).toBe(ErrorCode.ORDER_ALREADY_PAID);
    expect(ex.details).toEqual({ orderId: "o-1" });
  });
});
