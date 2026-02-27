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
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}
