import { NotFoundException } from "@nestjs/common";
import { LegalAdminController } from "./legal-admin.controller";
import { LegalPublicController } from "./legal-public.controller";
import { LegalDocumentsService } from "../services/legal-documents.service";
import { LegalDocumentKind } from "../constants";

/**
 * Long-tail spec for the legal controllers. Load-bearing contracts: the
 * public getCurrent rejects an unknown document kind with 404 (and defaults
 * locale to "tr"); the admin surface forwards list filters and the publish
 * dto to the service.
 */
describe("LegalPublicController", () => {
  let svc: { getCurrent: jest.Mock };
  let ctrl: LegalPublicController;

  beforeEach(() => {
    svc = { getCurrent: jest.fn().mockResolvedValue({ id: "d1" }) };
    ctrl = new LegalPublicController(svc as unknown as LegalDocumentsService);
  });

  it("returns the current document for a known kind", async () => {
    await ctrl.getCurrent(LegalDocumentKind.KVKK, "tr");
    expect(svc.getCurrent).toHaveBeenCalledWith(LegalDocumentKind.KVKK, "tr");
  });

  it("defaults the locale to 'tr' when omitted", async () => {
    await ctrl.getCurrent(LegalDocumentKind.REFUND_POLICY, undefined as any);
    expect(svc.getCurrent).toHaveBeenCalledWith(
      LegalDocumentKind.REFUND_POLICY,
      "tr",
    );
  });

  it("throws 404 for an unknown document kind", async () => {
    await expect(ctrl.getCurrent("COOKIES", "tr")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(svc.getCurrent).not.toHaveBeenCalled();
  });
});

describe("LegalAdminController", () => {
  let svc: { listAll: jest.Mock; publish: jest.Mock };
  let ctrl: LegalAdminController;

  beforeEach(() => {
    svc = {
      listAll: jest.fn().mockResolvedValue([]),
      publish: jest.fn().mockResolvedValue({}),
    };
    ctrl = new LegalAdminController(svc as unknown as LegalDocumentsService);
  });

  it("list forwards the kind + locale filters", async () => {
    await ctrl.list(LegalDocumentKind.KVKK, "en");
    expect(svc.listAll).toHaveBeenCalledWith(LegalDocumentKind.KVKK, "en");
  });

  it("publish forwards the dto", async () => {
    const dto = { kind: LegalDocumentKind.KVKK, version: "2.0" } as any;
    await ctrl.publish(dto);
    expect(svc.publish).toHaveBeenCalledWith(dto);
  });
});
