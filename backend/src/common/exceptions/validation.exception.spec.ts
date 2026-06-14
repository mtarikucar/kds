import { HttpStatus } from "@nestjs/common";
import {
  ValidationException,
  InvalidInputException,
  MissingRequiredFieldException,
  ResourceConflictException,
} from "./validation.exception";
import { ErrorCode } from "../interfaces/error-response.interface";

/**
 * Long-tail spec for the validation exception family. Load-bearing
 * contracts: correct status + ErrorCode and field/reason interpolation.
 */
describe("validation.exception family", () => {
  it("ValidationException → 400 VALIDATION_ERROR with details", () => {
    const ex = new ValidationException("bad", [{ field: "x" }]);
    expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(ex.errorCode).toBe(ErrorCode.VALIDATION_ERROR);
    expect(ex.details).toEqual([{ field: "x" }]);
  });

  it("InvalidInputException interpolates field and optional reason", () => {
    expect(new InvalidInputException("email", "not an email").message).toBe(
      "Invalid email: not an email",
    );
    expect(new InvalidInputException("email").message).toBe("Invalid email");
  });

  it("MissingRequiredFieldException → 400 with the field name", () => {
    const ex = new MissingRequiredFieldException("name");
    expect(ex.errorCode).toBe(ErrorCode.MISSING_REQUIRED_FIELD);
    expect(ex.message).toContain("name");
  });

  it("ResourceConflictException → 409", () => {
    const ex = new ResourceConflictException("dup");
    expect(ex.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(ex.errorCode).toBe(ErrorCode.RESOURCE_CONFLICT);
  });
});
