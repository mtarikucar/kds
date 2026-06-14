import { BadRequestException } from "@nestjs/common";
import {
  canTransition,
  validateTransition,
  isTerminalState,
  requiresApproval,
  getValidNextStates,
} from "./order-state-machine";
import { OrderStatus } from "../constants/order-status.enum";

/**
 * Long-tail spec for the order state machine. The load-bearing contracts:
 * only whitelisted transitions are allowed, a same-state move is a no-op,
 * CANCELLED is terminal (no exits), and validateTransition throws a
 * BadRequest with a Turkish operator-facing message on an illegal move.
 */
describe("order-state-machine", () => {
  describe("canTransition", () => {
    it("allows a forward step in the happy path", () => {
      expect(canTransition(OrderStatus.PENDING, OrderStatus.PREPARING)).toBe(
        true,
      );
      expect(canTransition(OrderStatus.READY, OrderStatus.SERVED)).toBe(true);
    });

    it("allows cancellation from any non-terminal state", () => {
      expect(canTransition(OrderStatus.PREPARING, OrderStatus.CANCELLED)).toBe(
        true,
      );
      expect(canTransition(OrderStatus.PAID, OrderStatus.CANCELLED)).toBe(true);
    });

    it("forbids skipping states and exiting a terminal state", () => {
      expect(canTransition(OrderStatus.PENDING, OrderStatus.SERVED)).toBe(false);
      expect(canTransition(OrderStatus.CANCELLED, OrderStatus.PENDING)).toBe(
        false,
      );
    });
  });

  describe("validateTransition", () => {
    it("is a no-op for a same-state transition", () => {
      expect(() =>
        validateTransition(OrderStatus.PREPARING, OrderStatus.PREPARING),
      ).not.toThrow();
    });

    it("passes a valid transition silently", () => {
      expect(() =>
        validateTransition(OrderStatus.PENDING, OrderStatus.PREPARING),
      ).not.toThrow();
    });

    it("throws BadRequestException with both states in the message", () => {
      try {
        validateTransition(OrderStatus.CANCELLED, OrderStatus.PENDING);
        fail("expected throw");
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).message).toContain(
          OrderStatus.CANCELLED,
        );
        expect((e as BadRequestException).message).toContain(
          OrderStatus.PENDING,
        );
      }
    });
  });

  describe("isTerminalState / requiresApproval / getValidNextStates", () => {
    it("marks PAID and CANCELLED as terminal", () => {
      expect(isTerminalState(OrderStatus.PAID)).toBe(true);
      expect(isTerminalState(OrderStatus.CANCELLED)).toBe(true);
      expect(isTerminalState(OrderStatus.PREPARING)).toBe(false);
    });

    it("flags only PENDING_APPROVAL as requiring approval", () => {
      expect(requiresApproval(OrderStatus.PENDING_APPROVAL)).toBe(true);
      expect(requiresApproval(OrderStatus.PENDING)).toBe(false);
    });

    it("returns an empty next-state list for the terminal CANCELLED state", () => {
      expect(getValidNextStates(OrderStatus.CANCELLED)).toEqual([]);
      expect(getValidNextStates(OrderStatus.PENDING)).toContain(
        OrderStatus.PREPARING,
      );
    });
  });
});
