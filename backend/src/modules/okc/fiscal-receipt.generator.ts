import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

export interface FiscalReceiptInput {
  orderNumber: string;
  items: Array<{
    name: string;
    quantity: number | string;
    /** KDV-inclusive unit price (Turkish retail prices include VAT). */
    unitPrice: number | string;
    taxRate: number;
  }>;
  paymentMethod?: string;
}

export interface FiscalReceiptLine {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  taxRate: number;
  kdvGroup: string;
}

export interface FiscalKdvGroup {
  group: string;
  rate: number;
  base: number;
  kdv: number;
  total: number;
}

export interface FiscalReceipt {
  orderNumber: string;
  lines: FiscalReceiptLine[];
  kdvGroups: FiscalKdvGroup[];
  totalKdv: number;
  grandTotal: number;
  paymentMethod: string;
}

const dec = (v: number | string) => new Prisma.Decimal(v);
const r2 = (d: Prisma.Decimal) => d.toDecimalPlaces(2).toNumber();

/**
 * ÖKC (yeni nesil yazarkasa) fiscal receipt builder. Turns an order into the
 * GMP-3 receipt structure: per-line KDV-inclusive totals, VAT broken down into
 * the standard department groups by rate (A=%1, B=%10, C=%20, D=%0), and the
 * grand total. Pure + Decimal-based — the device-independent core the ÖKC
 * device provider prints. Prices are treated as KDV-inclusive (TR retail
 * convention), so KDV = total × rate / (100 + rate).
 */
@Injectable()
export class FiscalReceiptGenerator {
  private static readonly GROUP_BY_RATE: Record<number, string> = {
    1: "A",
    8: "B",
    10: "B",
    18: "C",
    20: "C",
    0: "D",
  };

  private groupFor(rate: number): string {
    return FiscalReceiptGenerator.GROUP_BY_RATE[rate] ?? "C";
  }

  generate(input: FiscalReceiptInput): FiscalReceipt {
    const lines: FiscalReceiptLine[] = [];
    const groups = new Map<
      string,
      { group: string; rate: number; base: Prisma.Decimal; kdv: Prisma.Decimal }
    >();
    let grand = new Prisma.Decimal(0);
    let totalKdv = new Prisma.Decimal(0);

    for (const item of input.items) {
      const qty = dec(item.quantity);
      const unit = dec(item.unitPrice);
      const lineTotal = qty.mul(unit); // KDV-inclusive
      const rate = item.taxRate;
      const kdv = lineTotal.mul(rate).div(100 + rate);
      const base = lineTotal.sub(kdv);
      const group = this.groupFor(rate);

      grand = grand.add(lineTotal);
      totalKdv = totalKdv.add(kdv);
      const g = groups.get(group) ?? {
        group,
        rate,
        base: new Prisma.Decimal(0),
        kdv: new Prisma.Decimal(0),
      };
      g.base = g.base.add(base);
      g.kdv = g.kdv.add(kdv);
      groups.set(group, g);

      lines.push({
        name: item.name,
        quantity: qty.toNumber(),
        unitPrice: r2(unit),
        lineTotal: r2(lineTotal),
        taxRate: rate,
        kdvGroup: group,
      });
    }

    const kdvGroups: FiscalKdvGroup[] = [...groups.values()]
      .map((g) => ({
        group: g.group,
        rate: g.rate,
        base: r2(g.base),
        kdv: r2(g.kdv),
        total: r2(g.base.add(g.kdv)),
      }))
      .sort((a, b) => a.group.localeCompare(b.group));

    return {
      orderNumber: input.orderNumber,
      lines,
      kdvGroups,
      totalKdv: r2(totalKdv),
      grandTotal: r2(grand),
      paymentMethod: input.paymentMethod ?? "CASH",
    };
  }
}
