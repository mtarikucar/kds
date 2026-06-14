import { Response } from "express";
import { SuperAdminAuditController } from "./superadmin-audit.controller";
import { SuperAdminAuditService } from "../services/superadmin-audit.service";
import { ExportFormat } from "../dto/audit-filter.dto";

/**
 * Long-tail spec for the superadmin audit controller. Load-bearing
 * contracts: findAll forwards the filters; export sets the right
 * content-type + attachment headers per format and defaults to CSV when no
 * format is given.
 */
describe("SuperAdminAuditController", () => {
  let svc: { findAll: jest.Mock; export: jest.Mock };
  let ctrl: SuperAdminAuditController;

  beforeEach(() => {
    svc = {
      findAll: jest.fn().mockResolvedValue([]),
      export: jest.fn().mockResolvedValue("col1,col2"),
    };
    ctrl = new SuperAdminAuditController(
      svc as unknown as SuperAdminAuditService,
    );
  });

  it("findAll forwards the filters", async () => {
    const filters = { action: "LOGIN" } as any;
    await ctrl.findAll(filters);
    expect(svc.findAll).toHaveBeenCalledWith(filters);
  });

  it("export defaults to CSV headers when no format is given", async () => {
    const res = { setHeader: jest.fn(), send: jest.fn() } as unknown as Response;
    await ctrl.export({} as any, res);
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/csv");
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      "attachment; filename=audit-logs.csv",
    );
    expect(res.send).toHaveBeenCalledWith("col1,col2");
  });

  it("export sets JSON headers when format=JSON", async () => {
    const res = { setHeader: jest.fn(), send: jest.fn() } as unknown as Response;
    await ctrl.export({ format: ExportFormat.JSON } as any, res);
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/json",
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      "attachment; filename=audit-logs.json",
    );
  });
});
