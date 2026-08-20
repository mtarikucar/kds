import {
  ALACARTE_CATALOG,
  ALACARTE_CATALOG_BY_CODE,
  RETIRED_ADDON_CODES,
} from "./alacarte-catalog.const";
import {
  CatalogRowShape,
  LICENSE_ADDON_CODE,
  validateCatalogRow,
} from "./catalog-validation";

const LOCALES = ["tr", "en", "ru", "ar", "uz"] as const;

const base = (over: Partial<CatalogRowShape> = {}): CatalogRowShape => ({
  code: "probe",
  kind: "module",
  billing: "annual",
  priceCents: 99_000,
  status: "draft",
  grants: { "feature.advancedReports": true },
  deps: [],
  requiresLicense: true,
  ...over,
});

describe("validateCatalogRow — grant keys", () => {
  it("accepts a well-formed module", () => {
    expect(validateCatalogRow(base())).toEqual([]);
  });

  it("rejects a grant key nothing reads", () => {
    // The exact class of bug that shipped twice: a key that validates as JSON,
    // publishes, sells, and grants nothing.
    const problems = validateCatalogRow(
      base({ grants: { "limit.kdsScreens": 1 }, kind: "capacity" }),
    );
    expect(problems.join(" ")).toMatch(/unknown grant key "limit.kdsScreens"/);
  });

  it("rejects the limit.branches typo that once sold a phantom branch cap", () => {
    const problems = validateCatalogRow(
      base({ kind: "capacity", grants: { "limit.branches": 1 } }),
    );
    expect(problems.join(" ")).toMatch(/unknown grant key "limit.branches"/);
  });

  it("rejects a feature grant that is not a boolean", () => {
    const problems = validateCatalogRow(
      base({ grants: { "feature.advancedReports": 1 } }),
    );
    expect(problems.join(" ")).toMatch(/must be a boolean/);
  });

  it("rejects a zero or negative limit but allows the -1 unlimited sentinel", () => {
    expect(
      validateCatalogRow(
        base({ kind: "capacity", grants: { "limit.maxBranches": 0 } }),
      ).join(" "),
    ).toMatch(/positive count or -1/);
    expect(
      validateCatalogRow(
        base({ kind: "capacity", grants: { "limit.maxBranches": -1 } }),
      ),
    ).toEqual([]);
  });

  it("rejects an empty or non-string integration vendor list", () => {
    expect(
      validateCatalogRow(
        base({ kind: "integration", grants: { "integration.fiscal": [] } }),
      ).join(" "),
    ).toMatch(/non-empty array/);
    expect(
      validateCatalogRow(
        base({ kind: "integration", grants: { "integration.fiscal": "efatura" } }),
      ).join(" "),
    ).toMatch(/non-empty array/);
  });

  it("rejects credit.* as an entitlement grant", () => {
    const problems = validateCatalogRow(base({ grants: { "credit.PHOTO": 100 } }));
    expect(problems.join(" ")).toMatch(/credits are prepaid balances/);
  });
});

describe("validateCatalogRow — deps", () => {
  it("rejects a retired plan: dep", () => {
    // fiscal_hugin shipped with deps ["plan:PRO"]. Once currentPlanId goes
    // null this can never be satisfied and 400s every purchase.
    const problems = validateCatalogRow(base({ deps: ["plan:PRO"] }));
    expect(problems.join(" ")).toMatch(/Plans are retired/);
  });

  it("rejects a self-referencing dep", () => {
    const problems = validateCatalogRow(base({ code: "x", deps: ["x"] }));
    expect(problems.join(" ")).toMatch(/cannot reference the product itself/);
  });
});

describe("validateCatalogRow — per-kind rules", () => {
  it("requires the licence to be the singleton, self-free and annual", () => {
    expect(
      validateCatalogRow(
        base({
          code: LICENSE_ADDON_CODE,
          kind: "license",
          grants: { "feature.license": true },
          requiresLicense: false,
        }),
      ),
    ).toEqual([]);

    const wrongCode = validateCatalogRow(
      base({
        code: "another_license",
        kind: "license",
        grants: { "feature.license": true },
        requiresLicense: false,
      }),
    );
    expect(wrongCode.join(" ")).toMatch(/singleton/);

    const selfRequiring = validateCatalogRow(
      base({
        code: LICENSE_ADDON_CODE,
        kind: "license",
        grants: { "feature.license": true },
        requiresLicense: true,
      }),
    );
    expect(selfRequiring.join(" ")).toMatch(/cannot require itself/);
  });

  it("requires an integration row to actually grant an integration", () => {
    const problems = validateCatalogRow(
      base({ kind: "integration", grants: { "feature.apiAccess": true } }),
    );
    expect(problems.join(" ")).toMatch(/must grant at least one integration/);
  });

  it("requires a capacity row to grant a limit", () => {
    const problems = validateCatalogRow(
      base({ kind: "capacity", grants: { "feature.multiLocation": true } }),
    );
    expect(problems.join(" ")).toMatch(/must grant at least one limit/);
  });

  it("requires credits to declare kind + units, carry no grants and be oneTime", () => {
    expect(
      validateCatalogRow(
        base({
          kind: "credit",
          billing: "oneTime",
          grants: {},
          requiresLicense: false,
          creditKind: "PHOTO",
          creditUnits: 100,
        }),
      ),
    ).toEqual([]);

    const bad = validateCatalogRow(
      base({
        kind: "credit",
        billing: "annual",
        grants: { "feature.aiContentGeneration": true },
        requiresLicense: false,
        creditKind: "NOPE",
        creditUnits: 0,
      }),
    );
    expect(bad.join(" ")).toMatch(/creditKind to be one of/);
    expect(bad.join(" ")).toMatch(/positive integer creditUnits/);
    expect(bad.join(" ")).toMatch(/must not carry entitlement grants/);
    expect(bad.join(" ")).toMatch(/must be oneTime/);
  });
});

describe("validateCatalogRow — money", () => {
  it("refuses to publish a zero-price product", () => {
    // purchase() lets priceCents===0 through WITHOUT a paymentRef — that is
    // the comp path. Publishing a free row hands the product to everyone.
    const problems = validateCatalogRow(
      base({ status: "published", priceCents: 0 }),
    );
    expect(problems.join(" ")).toMatch(/bypasses the payment guard/);
  });

  it("allows a zero-price DRAFT (work in progress)", () => {
    expect(validateCatalogRow(base({ status: "draft", priceCents: 0 }))).toEqual(
      [],
    );
  });

  it("rejects a negative price", () => {
    expect(
      validateCatalogRow(base({ priceCents: -1 })).join(" "),
    ).toMatch(/non-negative integer/);
  });
});

describe("the shipped à-la-carte catalog", () => {
  it("every product satisfies the catalog invariants", () => {
    const failures = ALACARTE_CATALOG.flatMap((p) => {
      const problems = validateCatalogRow({
        code: p.code,
        kind: p.kind,
        billing: p.billing,
        priceCents: p.priceCents,
        // Validate as if published — these rows are destined for sale, and a
        // draft-only pass would let a zero price or a dead grant key slip
        // through until the day someone clicks Publish.
        status: "published",
        grants: p.grants,
        deps: p.deps,
        requiresLicense: p.requiresLicense,
        creditKind: p.creditKind,
        creditUnits: p.creditUnits,
        maxQuantity: p.maxQuantity,
      });
      return problems.map((msg) => `${p.code}: ${msg}`);
    });
    expect(failures).toEqual([]);
  });

  it("has unique codes and unique sort orders", () => {
    const codes = ALACARTE_CATALOG.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
    const orders = ALACARTE_CATALOG.map((p) => p.sortOrder);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("ships exactly one licence", () => {
    const licences = ALACARTE_CATALOG.filter((p) => p.kind === "license");
    expect(licences.map((p) => p.code)).toEqual([LICENSE_ADDON_CODE]);
  });

  it("resolves every dep to another product in the catalog", () => {
    for (const p of ALACARTE_CATALOG) {
      for (const dep of p.deps) {
        expect(ALACARTE_CATALOG_BY_CODE.has(dep)).toBe(true);
      }
    }
  });

  it("gates every AI/SMS credit pack behind the module that spends it", () => {
    // Without this, a tenant can buy credits they have no way to consume.
    expect(ALACARTE_CATALOG_BY_CODE.get("credit_ai_photo_100")!.deps).toEqual([
      "module_ai_studio",
    ]);
    expect(ALACARTE_CATALOG_BY_CODE.get("credit_sms_500")!.deps).toEqual([
      "sms_integration",
    ]);
  });

  it("ships exactly one delivery product covering all four platforms", () => {
    // Per-platform pricing was fiction: the route gate is domain-wide
    // (@RequiresIntegration("delivery") with no provider), so buying ANY one
    // platform already unlocked all four. One honest ₺2.499 line replaces it.
    const delivery = ALACARTE_CATALOG.filter((p) =>
      p.code.startsWith("delivery_"),
    );
    expect(delivery.map((p) => p.code)).toEqual(["delivery_platforms"]);
    const bundle = delivery[0];
    expect(bundle.grants["feature.deliveryIntegration"]).toBe(true);
    expect(bundle.grants["integration.delivery"]).toEqual([
      "yemeksepeti",
      "getir",
      "trendyol_yemek",
      "migros",
    ]);
    expect(bundle.priceCents).toBe(249_900);
  });

  it("does not resurrect a retired code", () => {
    for (const retired of RETIRED_ADDON_CODES) {
      expect(ALACARTE_CATALOG_BY_CODE.has(retired)).toBe(false);
    }
  });

  it("carries copy in all five supported locales", () => {
    // The catalog is customer-facing and the app ships tr/en/ar/ru/uz. A
    // missing locale renders a Turkish product name to an Arabic operator.
    for (const p of ALACARTE_CATALOG) {
      for (const locale of LOCALES) {
        const entry = p.i18n[locale];
        expect(entry?.name?.length).toBeGreaterThan(0);
        expect(entry?.description?.length).toBeGreaterThan(0);
      }
    }
  });

  it("prices every annual product above the PayTR minimum", () => {
    for (const p of ALACARTE_CATALOG) {
      expect(p.priceCents).toBeGreaterThanOrEqual(100);
    }
  });

  it("binds card shift to the personnel module", () => {
    const card = ALACARTE_CATALOG_BY_CODE.get("module_personnel_card_shift")!;
    expect(card).toBeDefined();
    expect(card.deps).toEqual(["module_personnel"]);
    expect(card.billing).toBe("oneTime");
    expect(card.priceCents).toBe(400_000);
    expect(card.requiresLicense).toBe(true);
    expect(card.sortOrder).toBe(18);
    expect(card.grants).toEqual({ "feature.cardShift": true });
    // maxQuantity is read ONLY for kind:'capacity'
    // (addon-purchasability.rules.ts:124-133); a module's second purchase is
    // blocked by isOwned instead. Setting it here would be inert noise.
    expect(card.maxQuantity).toBeUndefined();
  });

  it("accepts a oneTime cadence for kind:'module'", () => {
    // K5. catalog-validation.ts only pins a cadence for license (→annual),
    // credit and service (→oneTime); `case "module"` asks for at least one
    // feature.* grant and nothing else. This locks that in, because a
    // well-meaning "modules are annual" rule would make this product illegal.
    expect(
      validateCatalogRow(
        base({
          kind: "module",
          billing: "oneTime",
          grants: { "feature.cardShift": true },
        }),
      ),
    ).toEqual([]);
  });

  it("keeps every description's licence sentence — a one-time price is not forever", () => {
    // K21/§8 Risk 3: paying ₺4.000 once and then letting the licence lapse
    // DARKENS the module (plan-projector.service.ts:282). The five locale
    // descriptions are the only place the customer is told before they pay.
    const card = ALACARTE_CATALOG_BY_CODE.get("module_personnel_card_shift")!;
    const promises: Record<string, RegExp> = {
      tr: /lisansınız aktif olduğu sürece geçerlidir/i,
      en: /as long as your licence is active/i,
      ru: /пока действует ваша лицензия/i,
      ar: /ما دام ترخيصك ساريًا/,
      uz: /litsenziyangiz faol bo'lgunicha amal qiladi/i,
    };
    for (const [locale, pattern] of Object.entries(promises)) {
      expect(card.i18n[locale].description).toMatch(pattern);
    }
  });
});
