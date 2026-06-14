import { Response } from "express";
import { ZReportsController } from "./z-reports.controller";
import { ZReportsService } from "./z-reports.service";
import { BranchScope } from "../../common/scoping/branch-scope";

/**
 * Long-tail forwarding spec for ZReportsController. Load-bearing contracts:
 * the BranchScope (tenantId/branchId) is threaded into every service call;
 * userId falls back to req.user.id when the scope carries no userId; PDF
 * download sets attachment headers and streams the buffer.
 */
describe("ZReportsController", () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: ZReportsController;
  const scope = {
    tenantId: "t1",
    branchId: "b1",
    userId: undefined,
  } as unknown as BranchScope;
  const req = { user: { id: "u-fallback" } };

  beforeEach(() => {
    svc = {
      generateReport: jest.fn().mockResolvedValue({}),
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({}),
      generatePdf: jest.fn().mockResolvedValue(Buffer.from("PDF")),
      closeReport: jest.fn().mockResolvedValue({}),
      sendReportEmail: jest.fn().mockResolvedValue({}),
    };
    ctrl = new ZReportsController(svc as unknown as ZReportsService);
  });

  it("generate threads scope + falls back to req.user.id for the actor", async () => {
    const dto = { reportDate: "2026-06-14" } as any;
    await ctrl.generate(scope, req, dto);
    expect(svc.generateReport).toHaveBeenCalledWith("t1", "b1", "u-fallback", dto);
  });

  it("generate uses scope.userId when present", async () => {
    const scoped = { ...scope, userId: "u-scope" } as unknown as BranchScope;
    await ctrl.generate(scoped, req, {} as any);
    expect(svc.generateReport).toHaveBeenCalledWith(
      "t1",
      "b1",
      "u-scope",
      {},
    );
  });

  it("findAll forwards the scope + query to the service", async () => {
    const query = { page: 1 } as any;
    await ctrl.findAll(scope, query);
    expect(svc.findAll).toHaveBeenCalledWith(scope, query);
  });

  it("findOne forwards the id + scope", async () => {
    await ctrl.findOne(scope, "z1");
    expect(svc.findOne).toHaveBeenCalledWith("z1", scope);
  });

  it("downloadPdf streams the buffer with attachment headers", async () => {
    const res = { setHeader: jest.fn(), send: jest.fn() } as unknown as Response;
    await ctrl.downloadPdf(scope, "z1", res);
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "application/pdf");
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      "attachment; filename=z-report-z1.pdf",
    );
    expect(res.send).toHaveBeenCalledWith(expect.any(Buffer));
  });

  it("close forwards id, scope and the actor id", async () => {
    await ctrl.close(scope, req, "z1");
    expect(svc.closeReport).toHaveBeenCalledWith("z1", scope, "u-fallback");
  });

  it("sendEmail forwards the optional recipient list", async () => {
    await ctrl.sendEmail(scope, "z1", { emails: ["a@b.com"] });
    expect(svc.sendReportEmail).toHaveBeenCalledWith("z1", scope, ["a@b.com"]);
  });
});
