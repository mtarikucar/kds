export enum AttendanceStatus {
  CLOCKED_IN = 'CLOCKED_IN',
  ON_BREAK = 'ON_BREAK',
  CLOCKED_OUT = 'CLOCKED_OUT',
}

export enum ShiftAssignmentStatus {
  SCHEDULED = 'SCHEDULED',
  COMPLETED = 'COMPLETED',
  MISSED = 'MISSED',
  SWAPPED = 'SWAPPED',
}

export enum SwapRequestStatus {
  PENDING = 'PENDING',
  /** Target employee has consented; manager can now approve. */
  TARGET_ACCEPTED = 'TARGET_ACCEPTED',
  /** Target employee declined; swap is dead. */
  TARGET_REJECTED = 'TARGET_REJECTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}
