import {
  AttendanceStatus,
  ShiftAssignmentStatus,
  SwapRequestStatus,
} from "./personnel.enum";

/**
 * Long-tail drift-guard for the personnel enums. These drive the swap
 * state machine (PENDING → TARGET_ACCEPTED → APPROVED) and attendance/
 * payroll, persisted to the DB — value===name is load-bearing.
 */
describe("personnel.enum", () => {
  const valueEqualsName = (e: Record<string, string>) =>
    Object.entries(e).forEach(([name, value]) => expect(value).toBe(name));

  it("uses value===name for all personnel enums", () => {
    valueEqualsName(AttendanceStatus);
    valueEqualsName(ShiftAssignmentStatus);
    valueEqualsName(SwapRequestStatus);
  });

  it("keeps the two-step swap consent states", () => {
    expect(SwapRequestStatus.PENDING).toBe("PENDING");
    expect(SwapRequestStatus.TARGET_ACCEPTED).toBe("TARGET_ACCEPTED");
    expect(SwapRequestStatus.TARGET_REJECTED).toBe("TARGET_REJECTED");
    expect(SwapRequestStatus.APPROVED).toBe("APPROVED");
  });

  it("keeps the attendance clock states", () => {
    expect(AttendanceStatus.CLOCKED_IN).toBe("CLOCKED_IN");
    expect(AttendanceStatus.ON_BREAK).toBe("ON_BREAK");
    expect(AttendanceStatus.CLOCKED_OUT).toBe("CLOCKED_OUT");
  });
});
