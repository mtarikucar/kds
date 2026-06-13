import * as bcrypt from "bcryptjs";
import { AuthService } from "./auth.service";

/**
 * Security-observability: failed logins and refresh-token-reuse (theft signal)
 * detections must be countable so an alert can fire on a brute-force or
 * token-theft spike. The audit flagged these as firing silently.
 */
function build() {
  const prisma: any = {
    user: { findUnique: jest.fn() },
    refreshToken: { updateMany: jest.fn() },
  };
  const config: any = { get: jest.fn().mockReturnValue(undefined) };
  const metrics = { incCounter: jest.fn() };
  const svc = new AuthService(
    prisma,
    {} as any, // jwtService — unused on these paths
    config,
    {} as any, // emailService
    {} as any, // notificationsService
    metrics as any,
  );
  return { svc, prisma, metrics };
}

describe("AuthService security metrics", () => {
  it("counts a failed login for an unknown user", async () => {
    const { svc, prisma, metrics } = build();
    prisma.user.findUnique.mockResolvedValue(null);

    const result = await svc.validateUser("ghost@example.com", "whatever");

    expect(result).toBeNull();
    expect(metrics.incCounter).toHaveBeenCalledWith(
      "auth_login_failures_total",
      expect.any(String),
      { reason: "unknown_user" },
    );
  });

  it("counts a failed login for a bad password", async () => {
    const { svc, prisma, metrics } = build();
    const hash = await bcrypt.hash("correct-horse", 4);
    prisma.user.findUnique.mockResolvedValue({
      id: "u-1",
      password: hash,
      status: "ACTIVE",
      tenant: { status: "ACTIVE" },
    });

    const result = await svc.validateUser("u@example.com", "wrong-password");

    expect(result).toBeNull();
    expect(metrics.incCounter).toHaveBeenCalledWith(
      "auth_login_failures_total",
      expect.any(String),
      { reason: "bad_password" },
    );
  });

  it("does not count a failure on a successful credential check", async () => {
    const { svc, prisma, metrics } = build();
    const hash = await bcrypt.hash("right-pw", 4);
    prisma.user.findUnique.mockResolvedValue({
      id: "u-1",
      email: "u@example.com",
      password: hash,
      status: "ACTIVE",
      tenant: { status: "ACTIVE" },
    });

    const result = await svc.validateUser("u@example.com", "right-pw");

    expect(result).toMatchObject({ id: "u-1" });
    expect(metrics.incCounter).not.toHaveBeenCalled();
  });
});
