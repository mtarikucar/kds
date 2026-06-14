import { HttpStatus } from "@nestjs/common";
import {
  BusinessException,
  ResourceNotFoundException,
  ResourceAlreadyExistsException,
  InsufficientPermissionsException,
  InvalidCredentialsException,
  SubscriptionRequiredException,
  FeatureNotAvailableException,
  QuotaExceededException,
  InvalidOrderStatusException,
  InsufficientStockException,
} from "./business.exception";
import { ErrorCode } from "../interfaces/error-response.interface";

/**
 * Long-tail spec for the domain exception hierarchy. Load-bearing
 * contracts: each subclass carries the right HTTP status + ErrorCode and
 * embeds its interpolated identifiers in the message/details — the global
 * exception filter serializes these onto the API error envelope.
 */
describe("business.exception hierarchy", () => {
  it("BusinessException carries message, errorCode, status and details", () => {
    const ex = new BusinessException(
      "boom",
      ErrorCode.VALIDATION_ERROR,
      HttpStatus.BAD_REQUEST,
      { a: 1 },
    );
    expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(ex.errorCode).toBe(ErrorCode.VALIDATION_ERROR);
    expect(ex.details).toEqual({ a: 1 });
    expect(ex.getResponse()).toMatchObject({
      message: "boom",
      errorCode: ErrorCode.VALIDATION_ERROR,
    });
  });

  it("ResourceNotFoundException → 404 with the id interpolated", () => {
    const ex = new ResourceNotFoundException("Order", "abc");
    expect(ex.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(ex.errorCode).toBe(ErrorCode.RESOURCE_NOT_FOUND);
    expect(ex.message).toContain("abc");
  });

  it("ResourceNotFoundException without id omits the id clause", () => {
    const ex = new ResourceNotFoundException("Order");
    expect(ex.message).toBe("Order not found");
  });

  it("ResourceAlreadyExistsException → 409", () => {
    const ex = new ResourceAlreadyExistsException("User", "email", "a@b.com");
    expect(ex.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(ex.message).toContain("a@b.com");
  });

  it("InsufficientPermissionsException → 403", () => {
    const ex = new InsufficientPermissionsException("delete the menu");
    expect(ex.getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect(ex.message).toContain("delete the menu");
  });

  it("InvalidCredentialsException → 401", () => {
    const ex = new InvalidCredentialsException();
    expect(ex.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(ex.errorCode).toBe(ErrorCode.INVALID_CREDENTIALS);
  });

  it("SubscriptionRequiredException / FeatureNotAvailable / QuotaExceeded → 402", () => {
    expect(new SubscriptionRequiredException("POS").getStatus()).toBe(
      HttpStatus.PAYMENT_REQUIRED,
    );
    expect(
      new FeatureNotAvailableException("Analytics", "BUSINESS").getStatus(),
    ).toBe(HttpStatus.PAYMENT_REQUIRED);
    expect(new QuotaExceededException("branches", 3).message).toContain("3");
  });

  it("InvalidOrderStatusException → 400 with current status + action", () => {
    const ex = new InvalidOrderStatusException("PAID", "cancel");
    expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(ex.message).toContain("PAID");
    expect(ex.message).toContain("cancel");
  });

  it("InsufficientStockException attaches structured details", () => {
    const ex = new InsufficientStockException("Burger", 2, 5);
    expect(ex.details).toEqual({
      productName: "Burger",
      available: 2,
      requested: 5,
    });
    expect(ex.message).toContain("Burger");
  });
});
