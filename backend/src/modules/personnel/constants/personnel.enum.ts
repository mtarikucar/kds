export enum AttendanceStatus {
  CLOCKED_IN = "CLOCKED_IN",
  ON_BREAK = "ON_BREAK",
  CLOCKED_OUT = "CLOCKED_OUT",
}

/**
 * Which rail stamped an attendance punch.
 *
 * NOT covered by scripts/check-contract-drift.mjs (it pins a fixed list of
 * enums, and this one is not on it). The frontend therefore mirrors these
 * strings by hand — and does so as a BADGE lookup (`clockInSource === 'card'`),
 * never as a union type, so an unknown value degrades to "App" instead of
 * throwing.
 */
export enum AttendanceSource {
  MANUAL = "manual",
  CARD = "card",
}

export enum ShiftAssignmentStatus {
  SCHEDULED = "SCHEDULED",
  COMPLETED = "COMPLETED",
  MISSED = "MISSED",
  SWAPPED = "SWAPPED",
}

export enum SwapRequestStatus {
  PENDING = "PENDING",
  /** Target employee has consented; manager can now approve. */
  TARGET_ACCEPTED = "TARGET_ACCEPTED",
  /** Target employee declined; swap is dead. */
  TARGET_REJECTED = "TARGET_REJECTED",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
}
