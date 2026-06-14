import { DeliveryPlatform } from "../constants/platform.enum";
import { AdapterFactory } from "./adapter-factory";
import { GetirAdapter } from "./getir.adapter";
import { MigrosAdapter } from "./migros.adapter";
import { TrendyolAdapter } from "./trendyol.adapter";
import { YemeksepetiAdapter } from "./yemeksepeti.adapter";

/**
 * Locks the platform-string -> adapter-instance routing of AdapterFactory.
 * Each branch must return the SAME singleton instance that was injected, and
 * an unknown platform must throw (so a typo can never silently no-op).
 */
describe("AdapterFactory", () => {
  // Distinct sentinel objects so each branch is verified by reference identity.
  const getir = { __id: "getir" } as unknown as GetirAdapter;
  const yemeksepeti = { __id: "yemeksepeti" } as unknown as YemeksepetiAdapter;
  const trendyol = { __id: "trendyol" } as unknown as TrendyolAdapter;
  const migros = { __id: "migros" } as unknown as MigrosAdapter;

  let factory: AdapterFactory;

  beforeEach(() => {
    factory = new AdapterFactory(getir, yemeksepeti, trendyol, migros);
  });

  it("routes GETIR to the injected GetirAdapter instance", () => {
    expect(factory.getAdapter(DeliveryPlatform.GETIR)).toBe(getir);
  });

  it("routes YEMEKSEPETI to the injected YemeksepetiAdapter instance", () => {
    expect(factory.getAdapter(DeliveryPlatform.YEMEKSEPETI)).toBe(yemeksepeti);
  });

  it("routes TRENDYOL to the injected TrendyolAdapter instance", () => {
    expect(factory.getAdapter(DeliveryPlatform.TRENDYOL)).toBe(trendyol);
  });

  it("routes MIGROS to the injected MigrosAdapter instance", () => {
    expect(factory.getAdapter(DeliveryPlatform.MIGROS)).toBe(migros);
  });

  it("accepts the raw enum string values (not just the enum members)", () => {
    expect(factory.getAdapter("GETIR")).toBe(getir);
    expect(factory.getAdapter("YEMEKSEPETI")).toBe(yemeksepeti);
    expect(factory.getAdapter("TRENDYOL")).toBe(trendyol);
    expect(factory.getAdapter("MIGROS")).toBe(migros);
  });

  it("throws for an unknown platform", () => {
    expect(() => factory.getAdapter("DOORDASH")).toThrow(
      "Unknown delivery platform: DOORDASH",
    );
  });

  it("throws for an empty platform string", () => {
    expect(() => factory.getAdapter("")).toThrow(
      "Unknown delivery platform: ",
    );
  });
});
