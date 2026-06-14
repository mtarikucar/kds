import { SuperAdminAuditService } from "./superadmin-audit.service";
import { ExportFormat } from "../dto/audit-filter.dto";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";

/**
 * The audit service's high-value surface is the CSV export, which interpolates
 * attacker-controllable tenant names / emails into a spreadsheet. A formula
 * injection (a cell starting =, +, -, @) that Excel auto-executes is a real
 * data-exfil vector, so escapeCsvCell prefixes such cells with a `'` and
 * double-quotes everything. These specs pin that escaping plus the
 * date-range / filter where-building and the JSON export path.
 */
describe("SuperAdminAuditService", () => {
  let prisma: MockPrismaClient;
  let svc: SuperAdminAuditService;

  const row = {
    id: "log-1",
    action: "SUSPEND",
    entityType: "TENANT",
    entityId: "t-1",
    actorId: "sa-1",
    actorEmail: "ops@platform.com",
    targetTenantId: "t-1",
    targetTenantName: "Acme",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new SuperAdminAuditService(prisma as any);
  });

  describe("export — CSV injection hardening", () => {
    it("neutralises a formula-injection tenant name by prefixing it with a quote", async () => {
      prisma.auditLog.findMany.mockResolvedValue([
        { ...row, targetTenantName: "=cmd|' /C calc'!A1" },
      ] as any);

      const csv = await svc.export({ format: ExportFormat.CSV } as any);
      // The dangerous leading '=' is escaped to "'=..." so the spreadsheet
      // treats it as text, and the whole cell is double-quoted.
      expect(csv).toContain(`"'=cmd|' /C calc'!A1"`);
    });

    it("doubles embedded double-quotes so the CSV stays well-formed", async () => {
      prisma.auditLog.findMany.mockResolvedValue([
        { ...row, targetTenantName: 'Ac"me' },
      ] as any);
      const csv = await svc.export({ format: ExportFormat.CSV } as any);
      expect(csv).toContain(`"Ac""me"`);
    });

    it("renders a leading header row and a data row in CSV", async () => {
      prisma.auditLog.findMany.mockResolvedValue([row] as any);
      const csv = await svc.export({ format: ExportFormat.CSV } as any);
      const lines = csv.split("\n");
      expect(lines[0]).toContain(`"ID"`);
      expect(lines[0]).toContain(`"Action"`);
      expect(lines[1]).toContain(`"log-1"`);
      expect(lines[1]).toContain(`"SUSPEND"`);
      expect(lines[1]).toContain(`"2026-01-01T00:00:00.000Z"`);
    });

    it("renders empty strings (not 'null') for missing optional columns", async () => {
      prisma.auditLog.findMany.mockResolvedValue([
        { ...row, entityId: null, targetTenantId: null, targetTenantName: null },
      ] as any);
      const csv = await svc.export({ format: ExportFormat.CSV } as any);
      const dataLine = csv.split("\n")[1];
      // entityId / targetTenantId / targetTenantName fall back to "".
      expect(dataLine).toContain(`""`);
      expect(dataLine).not.toContain("null");
    });

    it("returns pretty-printed JSON for the JSON format", async () => {
      prisma.auditLog.findMany.mockResolvedValue([row] as any);
      const out = await svc.export({ format: ExportFormat.JSON } as any);
      expect(JSON.parse(out)).toHaveLength(1);
      expect(out).toContain("\n  "); // indented (pretty) output
    });
  });

  describe("findAll — filter where-building", () => {
    it("builds a createdAt gte/lte range from startDate + endDate", async () => {
      prisma.auditLog.findMany.mockResolvedValue([] as any);
      prisma.auditLog.count.mockResolvedValue(0 as any);

      await svc.findAll({
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        page: 2,
        limit: 10,
      } as any);

      const arg = prisma.auditLog.findMany.mock.calls[0][0] as any;
      expect(arg.where.createdAt.gte).toEqual(new Date("2026-01-01"));
      expect(arg.where.createdAt.lte).toEqual(new Date("2026-01-31"));
      // page 2, limit 10 → skip 10.
      expect(arg.skip).toBe(10);
      expect(arg.take).toBe(10);
    });

    it("omits createdAt entirely when neither date bound is supplied", async () => {
      prisma.auditLog.findMany.mockResolvedValue([] as any);
      prisma.auditLog.count.mockResolvedValue(3 as any);

      const res = await svc.findAll({ actorId: "sa-1" } as any);
      const arg = prisma.auditLog.findMany.mock.calls[0][0] as any;
      expect(arg.where.createdAt).toBeUndefined();
      expect(arg.where.actorId).toBe("sa-1");
      // default page=1, limit=50 → totalPages = ceil(3/50) = 1.
      expect(res.meta).toMatchObject({ page: 1, limit: 50, totalPages: 1 });
    });
  });
});
