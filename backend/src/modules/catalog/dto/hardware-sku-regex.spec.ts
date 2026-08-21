import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { CreateHardwareProductDto } from "./create-hardware-product.dto";
import { HardwareQuoteRequestDto } from "./hardware-quote-request.dto";
import {
  PRINT3D_BASE_SKU,
  PRINT3D_ITEM_SKU,
} from "../../print3d/print3d.const";
import { PRODUCTS, SERVICES } from "../../../../prisma/seeds/seed-marketplace";

/**
 * SKU regex'i alt çizgiye açıldı (^[a-z0-9][a-z0-9_-]{2,63}$).
 *
 * Neden: onaylı print3d SKU'ları alt çizgi taşıyor ve eski regex onları
 * reddediyordu — yani superadmin katalog API'sinden bu iki satır hiç
 * yönetilemezdi. Genişletme kesinlikle geriye dönük uyumlu olmalı: mevcut
 * her SKU hâlâ eşleşmeli, ve daralma yönünde hiçbir şey açılmamalı.
 */
function skuErrors(sku: string): string[] {
  const dto = plainToInstance(CreateHardwareProductDto, {
    sku,
    category: "service",
    name: "X",
    priceCents: 1,
  });
  return validateSync(dto)
    .filter((e) => e.property === "sku")
    .map((e) => Object.values(e.constraints ?? {}).join("|"));
}

function quoteSkuErrors(sku: string): string[] {
  const dto = plainToInstance(HardwareQuoteRequestDto, { sku });
  return validateSync(dto)
    .filter((e) => e.property === "sku")
    .map((e) => Object.values(e.constraints ?? {}).join("|"));
}

describe("hardware SKU regex", () => {
  it("accepts the print3d SKUs (underscore)", () => {
    for (const sku of [PRINT3D_BASE_SKU, PRINT3D_ITEM_SKU]) {
      expect(skuErrors(sku)).toEqual([]);
      expect(quoteSkuErrors(sku)).toEqual([]);
    }
  });

  it("still accepts every SKU the seed ships", () => {
    for (const p of [...PRODUCTS, ...SERVICES]) {
      expect(skuErrors(p.sku)).toEqual([]);
    }
  });

  it("still rejects uppercase, spaces and leading punctuation", () => {
    for (const bad of ["Print3D_Base", "print3d base", "_print3d", "-abc", "ab"]) {
      expect(skuErrors(bad).length).toBeGreaterThan(0);
    }
  });
});
