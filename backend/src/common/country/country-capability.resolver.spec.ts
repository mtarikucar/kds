import { NotFoundException, Global, Module } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { CountryCapabilityResolver } from "./country-capability.resolver";
import { CountryService } from "./country.service";
import { COUNTRY_PROFILES } from "./country-profile.const";
import { PrismaService } from "../../prisma/prisma.service";
import { mockPrismaClient } from "../test/prisma-mock.service";
import { PaymentProviderRegistry } from "../../modules/payments-core/payment-provider.registry";
import { PaymentProvider } from "../../modules/payments-core/payment-provider.interface";
import { FiscalProviderRegistry } from "../../modules/fiscal-core/fiscal-provider.registry";
import { FiscalProvider } from "../../modules/fiscal-core/fiscal-provider.interface";
import { EscPosBuilderRegistry } from "../../modules/device-mesh/printing/escpos-builder.registry";
import { EscPosBuilder } from "../../modules/device-mesh/printing/escpos.types";
import { AccountingProvider } from "../../modules/accounting/constants/accounting.enum";
import { OutboxModule } from "../../modules/outbox/outbox.module";
import { OutboxWorkerService } from "../../modules/outbox/outbox-worker.service";
import { LicensingService } from "../../modules/licensing/licensing.service";

const fakePayment = (id: string): PaymentProvider =>
  ({ id, modes: ["online"] }) as unknown as PaymentProvider;
const fakeFiscal = (id: string): FiscalProvider =>
  ({ id, capabilities: ["receipt"] }) as unknown as FiscalProvider;
const fakeEscpos = (id: string): EscPosBuilder => ({ id }) as unknown as EscPosBuilder;

/**
 * Builds a resolver wired to REAL registry instances (same class as
 * production — only the concrete provider objects registered into them are
 * fakes, same idiom as fiscal-provider.registry.spec.ts) and a REAL
 * CountryService over a mocked Prisma. `tenantCountry` maps tenantId ->
 * countryCode, exactly like the `tenant` row CountryService.forTenant reads.
 */
function makeHarness(tenantCountry: Record<string, string>) {
  const prisma = mockPrismaClient();
  (prisma.tenant.findUnique as any).mockImplementation(async ({ where }: any) => {
    const code = tenantCountry[where.id];
    return code ? { countryCode: code } : null;
  });

  const country = new CountryService(prisma as any);
  const paymentRegistry = new PaymentProviderRegistry();
  const fiscalRegistry = new FiscalProviderRegistry();
  const escposRegistry = new EscPosBuilderRegistry();

  paymentRegistry.register(fakePayment("paytr"));
  fiscalRegistry.register(fakeFiscal("fiscal_hugin"));
  fiscalRegistry.register(fakeFiscal("fiscal_paygo"));
  fiscalRegistry.register(fakeFiscal("fiscal_beko"));
  fiscalRegistry.register(fakeFiscal("efatura"));
  escposRegistry.register(fakeEscpos("escpos-tr"));

  const resolver = new CountryCapabilityResolver(
    country,
    paymentRegistry,
    fiscalRegistry,
    escposRegistry,
    prisma as any,
  );

  return { resolver, prisma, country, paymentRegistry, fiscalRegistry, escposRegistry };
}

describe("CountryCapabilityResolver", () => {
  describe("paymentProviderFor", () => {
    it("resolves the Turkish payment provider for a TR tenant", async () => {
      const { resolver } = makeHarness({ "tr-tenant": "TR" });
      const provider = await resolver.paymentProviderFor("tr-tenant");
      expect(provider.id).toBe("paytr");
    });

    it("REFUSES for a UZ tenant instead of silently falling back to PayTR", async () => {
      const { resolver } = makeHarness({ "uz-tenant": "UZ" });
      await expect(resolver.paymentProviderFor("uz-tenant")).rejects.toThrow(
        /no payment provider configured for UZ/i,
      );
    });

    it("throws a clear error when a profile names a provider the registry does not have", async () => {
      const { paymentRegistry, fiscalRegistry, escposRegistry, prisma } = makeHarness({});
      const badCountry = {
        forTenant: jest.fn().mockResolvedValue({
          ...COUNTRY_PROFILES.TR,
          capabilities: {
            ...COUNTRY_PROFILES.TR.capabilities,
            paymentProviderIds: ["totally-bogus-id"],
          },
        }),
      } as unknown as CountryService;
      const resolver = new CountryCapabilityResolver(
        badCountry,
        paymentRegistry,
        fiscalRegistry,
        escposRegistry,
        prisma as any,
      );

      await expect(resolver.paymentProviderFor("any-tenant")).rejects.toThrow(
        /totally-bogus-id/,
      );
      // Must fail loudly with a config-error message naming the bad id, NOT
      // the registry's raw 404 — a 404 could otherwise surface deep inside a
      // payment flow looking like "provider not found" instead of "the
      // country profile is misconfigured".
      await expect(
        resolver.paymentProviderFor("any-tenant"),
      ).rejects.not.toBeInstanceOf(NotFoundException);
    });
  });

  describe("escposBuilderFor", () => {
    it("resolves the shared ESC/POS builder for a TR tenant", async () => {
      const { resolver } = makeHarness({ "tr-tenant": "TR" });
      const builder = await resolver.escposBuilderFor("tr-tenant");
      expect(builder.id).toBe("escpos-tr");
    });

    it("UZ also resolves it today — the profile names one (no refusal here)", async () => {
      const { resolver } = makeHarness({ "uz-tenant": "UZ" });
      const builder = await resolver.escposBuilderFor("uz-tenant");
      expect(builder.id).toBe("escpos-tr");
    });

    it("throws a clear error when the profile names an unregistered builder id", async () => {
      const { paymentRegistry, fiscalRegistry, prisma } = makeHarness({});
      const emptyEscposRegistry = new EscPosBuilderRegistry(); // nothing registered
      const badCountry = {
        forTenant: jest.fn().mockResolvedValue(COUNTRY_PROFILES.TR),
      } as unknown as CountryService;
      const resolver = new CountryCapabilityResolver(
        badCountry,
        paymentRegistry,
        fiscalRegistry,
        emptyEscposRegistry,
        prisma as any,
      );
      await expect(resolver.escposBuilderFor("any-tenant")).rejects.toThrow(
        /escpos-tr/,
      );
    });
  });

  describe("smsProviderIdFor", () => {
    it("resolves netgsm for a TR tenant", async () => {
      const { resolver } = makeHarness({ "tr-tenant": "TR" });
      expect(await resolver.smsProviderIdFor("tr-tenant")).toBe("netgsm");
    });

    it("REFUSES for a UZ tenant instead of silently falling back to the Turkish SMS provider", async () => {
      const { resolver } = makeHarness({ "uz-tenant": "UZ" });
      await expect(resolver.smsProviderIdFor("uz-tenant")).rejects.toThrow(
        /no sms provider configured for UZ/i,
      );
    });
  });

  describe("fiscalProviderFor — fiscal is a SET, the tenant's configured device picks from it", () => {
    it("resolves the tenant's configured device once it validates against TR's legal set", async () => {
      const { resolver, prisma } = makeHarness({ "tr-tenant": "TR" });
      (prisma.fiscalDeviceRecord.findFirst as any).mockResolvedValue({
        id: "fd-1",
        tenantId: "tr-tenant",
        providerId: "fiscal_hugin",
        status: "online",
      });
      const provider = await resolver.fiscalProviderFor("tr-tenant");
      expect(provider.id).toBe("fiscal_hugin");
    });

    it("REFUSES for a UZ tenant — the country has no legal fiscal set, regardless of any device row", async () => {
      const { resolver, prisma } = makeHarness({ "uz-tenant": "UZ" });
      (prisma.fiscalDeviceRecord.findFirst as any).mockResolvedValue({
        id: "fd-1",
        tenantId: "uz-tenant",
        providerId: "fiscal_hugin",
        status: "online",
      });
      await expect(resolver.fiscalProviderFor("uz-tenant")).rejects.toThrow(
        /no fiscal provider configured for UZ/i,
      );
    });

    it("throws a DISTINCT error when the tenant has configured no fiscal device at all", async () => {
      const { resolver, prisma } = makeHarness({ "tr-tenant": "TR" });
      (prisma.fiscalDeviceRecord.findFirst as any).mockResolvedValue(null);
      await expect(resolver.fiscalProviderFor("tr-tenant")).rejects.toThrow(
        /no fiscal device configured/i,
      );
      // Distinct from the country-level refusal message.
      await expect(resolver.fiscalProviderFor("tr-tenant")).rejects.not.toThrow(
        /no fiscal provider configured for/i,
      );
    });

    it("REFUSES a device whose provider is not in the country's legal set — never trusts the tenant blindly", async () => {
      const { resolver, prisma } = makeHarness({ "tr-tenant": "TR" });
      (prisma.fiscalDeviceRecord.findFirst as any).mockResolvedValue({
        id: "fd-1",
        tenantId: "tr-tenant",
        providerId: "some_unauthorized_device",
        status: "online",
      });
      await expect(resolver.fiscalProviderFor("tr-tenant")).rejects.toThrow(
        /not legal in TR/i,
      );
    });

    it("throws a clear config error when the device's provider is legal but not actually registered", async () => {
      const prisma = mockPrismaClient();
      (prisma.tenant.findUnique as any).mockResolvedValue({ countryCode: "TR" });
      (prisma.fiscalDeviceRecord.findFirst as any).mockResolvedValue({
        id: "fd-1",
        tenantId: "tr-tenant",
        providerId: "fiscal_paygo", // legal in TR...
        status: "online",
      });
      const country = new CountryService(prisma as any);
      const fiscalRegistry = new FiscalProviderRegistry();
      fiscalRegistry.register(fakeFiscal("fiscal_hugin")); // ...but not registered here
      const resolver = new CountryCapabilityResolver(
        country,
        new PaymentProviderRegistry(),
        fiscalRegistry,
        new EscPosBuilderRegistry(),
        prisma as any,
      );
      await expect(resolver.fiscalProviderFor("tr-tenant")).rejects.toThrow(
        /fiscal_paygo/,
      );
    });
  });
});

// Same idiom as country.service.spec.ts's "CountryService module registration"
// test: a stand-in ConfigService, since the real ConfigModule.forRoot() only
// exists in AppModule and several adapters below (PayTR, local-bridge,
// device-mesh) inject ConfigService.
@Global()
@Module({
  providers: [{ provide: ConfigService, useValue: { get: () => undefined } }],
  exports: [ConfigService],
})
class StubConfigGlobalsModule {}

/**
 * LicensingModule is @Global() in production, but nothing in
 * FiscalCoreModule/PaymentsCoreModule/DeviceMeshModule/CommonModule imports
 * it BY NAME — its provider (LicensingService, consumed transitively by
 * EntitlementOfferResolver inside SubscriptionsModule -> EntitlementsModule)
 * is only reachable in the real app because AppModule loads LicensingModule
 * once and its @Global() status makes the export ambient everywhere. Since
 * nothing here imports the real module, this stand-in cannot "lose" to a
 * concrete provider the way the PrismaService stub would — same posture as
 * StubConfigGlobalsModule above. Pulling in the REAL LicensingModule would
 * drag in CheckoutModule -> Catalog/Marketplace/Legal, none of which this
 * test is about: it is proving country-profile ids resolve in the payment /
 * fiscal / ESC-POS registries, not exercising the pricing engine.
 */
@Global()
@Module({
  providers: [{ provide: LicensingService, useValue: {} }],
  exports: [LicensingService],
})
class StubLicensingGlobalsModule {}

describe("CountryCapabilityResolver — real DI wiring", () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    const { CommonModule } = await import("../common.module");

    // overrideProvider, not a stand-in module: several modules in this graph
    // (PaymentsCoreModule, FiscalCoreModule, DeviceMeshModule) import
    // PrismaModule directly, and a concrete provider from an imported module
    // beats a same-token global stub — so without this the REAL PrismaService
    // is constructed and `new PrismaClient()` throws whenever DATABASE_URL is
    // absent (the CI unit-test job has no live database).
    moduleRef = await Test.createTestingModule({
      // OutboxModule is @Global() in production (imported once by AppModule)
      // but this standalone test graph doesn't include AppModule, so its
      // exports (DomainEventBus, OutboxService — consumed transitively via
      // EntitlementsModule/CommandQueueService) need to be pulled in
      // explicitly here too.
      imports: [
        StubConfigGlobalsModule,
        StubLicensingGlobalsModule,
        OutboxModule,
        CommonModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      // OutboxWorkerService's onModuleInit schedules a real setTimeout tick
      // against Prisma — irrelevant to what this test proves (registry
      // self-registration) and it only fires an async, unhandled "outbox
      // tick failed" error against the bare {} PrismaService stub above.
      // Neutered the same way PrismaService is: not a fake capability, just
      // supporting infra this test doesn't exercise.
      .overrideProvider(OutboxWorkerService)
      .useValue({ onModuleInit: () => undefined, onModuleDestroy: () => undefined })
      .compile();

    // compile() alone only INSTANTIATES providers — it does not run
    // lifecycle hooks. Every adapter self-registers inside onModuleInit()
    // (HuginFiscalProvider, PaytrPaymentProvider, EscPosBuilderService, …),
    // so without this every registry.list() below would be empty and this
    // "real DI" test would silently prove nothing. callInitHook() (not the
    // full init(), which also fires onApplicationBootstrap — entitlement
    // backfills, the outbox worker tick, DeviceMeshScheduler's cron — none of
    // which this test needs, and all of which would just fail noisily
    // against the bare `{}` PrismaService stub above) runs exactly the
    // onModuleInit hooks the self-registration relies on.
    await moduleRef.callInitHook();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it("resolves CountryCapabilityResolver through real Nest DI via CommonModule", () => {
    expect(moduleRef.get(CountryCapabilityResolver)).toBeInstanceOf(
      CountryCapabilityResolver,
    );
  });

  // THE IMPORTANT ONE. Task 1's review caught four wrong ids ("generic" vs
  // "escpos-tr", "hugin" vs "fiscal_hugin", "nilvera" vs "NILVERA", and an
  // "eskiz" that existed nowhere) that no unit test could see, because a
  // profile is just strings. This test walks every profile against the real,
  // fully self-registered DI container and closes that hole for every
  // country added later.
  it("every id named by every profile actually exists in its registry", () => {
    const paymentRegistry = moduleRef.get(PaymentProviderRegistry);
    const fiscalRegistry = moduleRef.get(FiscalProviderRegistry);
    const escposRegistry = moduleRef.get(EscPosBuilderRegistry);

    for (const profile of Object.values(COUNTRY_PROFILES)) {
      for (const id of profile.capabilities.fiscalProviderIds) {
        expect(fiscalRegistry.list().map((p) => p.id)).toContain(id);
      }
      for (const id of profile.capabilities.paymentProviderIds) {
        expect(paymentRegistry.list().map((p) => p.id)).toContain(id);
      }
      expect(escposRegistry.list().map((b) => b.id)).toContain(
        profile.capabilities.escposBuilderId,
      );
      if (profile.capabilities.eDocumentAdapterId) {
        expect(Object.values(AccountingProvider)).toContain(
          profile.capabilities.eDocumentAdapterId,
        );
      }
    }
  });
});
