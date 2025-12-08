import { BadRequestException } from '@nestjs/common';
import { OrderStatus } from '../constants/order-status.enum';

/**
 * Valid state transitions for orders
 * This enforces a strict state machine - orders can only move through valid states
 */
const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING_APPROVAL]: [OrderStatus.PENDING, OrderStatus.CANCELLED],
  [OrderStatus.PENDING]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  [OrderStatus.PREPARING]: [OrderStatus.READY, OrderStatus.CANCELLED],
  [OrderStatus.READY]: [OrderStatus.SERVED, OrderStatus.CANCELLED],
  [OrderStatus.SERVED]: [OrderStatus.PAID],
  [OrderStatus.PAID]: [], // Terminal state - no transitions allowed
  [OrderStatus.CANCELLED]: [], // Terminal state - no transitions allowed
};

/**
 * Check if a state transition is valid
 * @param from Current order status
 * @param to Target order status
 * @returns true if transition is valid, false otherwise
 */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Validate and throw if transition is invalid (STRICT mode)
 * @param from Current order status
 * @param to Target order status
 * @throws BadRequestException if transition is invalid
 */
export function validateTransition(from: OrderStatus, to: OrderStatus): void {
  if (from === to) {
    return; // Same state is always allowed (no-op)
  }

  if (!canTransition(from, to)) {
    throw new BadRequestException(
      `Geçersiz durum geçişi: ${from} → ${to}. ` +
        `${from} durumundan izin verilen geçişler: ${
          VALID_TRANSITIONS[from]?.join(', ') || 'hiçbiri (terminal durum)'
        }`,
    );
  }
}

/**
 * Check if order is in a terminal state (cannot be modified)
 * @param status Current order status
 * @returns true if order is in terminal state
 */
export function isTerminalState(status: OrderStatus): boolean {
  return (
    status === OrderStatus.PAID || status === OrderStatus.CANCELLED
  );
}

/**
 * Check if order requires approval before proceeding
 * @param status Current order status
 * @returns true if order needs approval
 */
export function requiresApproval(status: OrderStatus): boolean {
  return status === OrderStatus.PENDING_APPROVAL;
}

/**
 * Get all valid next states for a given status
 * @param status Current order status
 * @returns Array of valid next statuses
 */
export function getValidNextStates(status: OrderStatus): OrderStatus[] {
  return VALID_TRANSITIONS[status] || [];
}
