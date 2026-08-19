import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { MenuImportController } from "./menu-import.controller";
import { MenuImportService } from "../services/menu-import.service";
import { MenuSourceService } from "../services/menu-source.service";
import { MenuSourceFetcher } from "../services/menu-source-fetcher.service";
import { PrismaService } from "../../../prisma/prisma.service";
import { EntitlementService } from "../../entitlements/entitlement.service";
import { CreditService } from "../../credits/credit.service";

describe("MenuImportController parse-source", () => {
  const menuImport = { annotateConflicts: jest.fn((d) => Promise.resolve(d)) };
  const menuSource = { parseSource: jest.fn() };
  const ctrl = new MenuImportController(menuImport as any, menuSource as any);

  it("passes a url through and annotates conflicts before returning", async () => {
    menuSource.parseSource.mockResolvedValue({ categories: [] });
    await ctrl.parseSource({ url: "https://x.test/menu" } as any, [], {
      tenantId: "t1",
    } as any);
    expect(menuSource.parseSource).toHaveBeenCalledWith("t1", {
      url: "https://x.test/menu",
      file: undefined,
    });
    expect(menuImport.annotateConflicts).toHaveBeenCalled();
  });

  it("passes an uploaded file through instead", async () => {
    menuSource.parseSource.mockResolvedValue({ categories: [] });
    const file = {
      buffer: Buffer.from("x"),
      mimetype: "application/pdf",
      originalname: "m.pdf",
    };
    await ctrl.parseSource({} as any, [file] as any, { tenantId: "t1" } as any);
    expect(menuSource.parseSource).toHaveBeenCalledWith("t1", {
      url: undefined,
      file,
    });
  });

  it("returns the draft after annotateConflicts, not the raw parseSource result", async () => {
    const rawDraft = { categories: [{ name: "raw" }] };
    const annotated = { categories: [{ name: "annotated" }] };
    menuSource.parseSource.mockResolvedValue(rawDraft);
    menuImport.annotateConflicts.mockResolvedValue(annotated);
    const result = await ctrl.parseSource(
      { url: "https://x.test/menu" } as any,
      [],
      {
        tenantId: "t1",
      } as any,
    );
    expect(menuImport.annotateConflicts).toHaveBeenCalledWith(rawDraft, "t1");
    expect(result).toBe(annotated);
  });
});

// Stand-ins for the leaf dependencies that sit OUTSIDE menu.module.ts's own
// imports (PrismaModule/PosSettingsModule/UploadModule): PrismaService and
// ConfigService are app-globals in production (AppModule), and
// EntitlementService/CreditService come from the @Global() Entitlements-
// and Credits modules. Pulling in the real versions of those would mean
// booting their outbox/event-bus machinery too, which is unrelated to what
// this task changes. A small @Global() stub module supplies just the
// tokens MenuModule's existing providers already depend on, the same way
// the real @Global() modules would in a full app boot.
@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: {} },
    { provide: ConfigService, useValue: { get: () => undefined } },
    { provide: EntitlementService, useValue: {} },
    { provide: CreditService, useValue: {} },
  ],
  exports: [PrismaService, ConfigService, EntitlementService, CreditService],
})
class StubGlobalsModule {}

// Compiles MenuModule's real provider graph so a provider that is declared
// but cannot be constructed (missing import, wrong token, circular dep)
// fails here instead of only at runtime in production. The controller spec
// above instantiates MenuImportController by hand (`new`), which bypasses
// Nest's DI entirely and would never notice MenuSourceService/
// MenuSourceFetcher going unregistered or unresolvable.
describe("MenuModule provider graph", () => {
  it("resolves MenuSourceService and MenuSourceFetcher through real DI", async () => {
    const { MenuModule } = await import("../menu.module");

    const moduleRef = await Test.createTestingModule({
      imports: [StubGlobalsModule, MenuModule],
    }).compile();

    expect(moduleRef.get(MenuSourceService)).toBeInstanceOf(MenuSourceService);
    expect(moduleRef.get(MenuSourceFetcher)).toBeInstanceOf(MenuSourceFetcher);
    expect(moduleRef.get(MenuImportService)).toBeInstanceOf(MenuImportService);
  });
});
