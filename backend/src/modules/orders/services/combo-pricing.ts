/**
 * Pure combo + campaign pricing. NO DB, NO Nest — fully unit-testable money
 * math (spec §4). Two responsibilities:
 *
 *  1. resolveEffectivePrice() — the SINGLE source of truth for a product's
 *     charged price: the campaign price when the window is active, else the
 *     list price. Read by BOTH order-pricing rails AND the public menu, so
 *     "shown price == charged price" always holds.
 *
 *  2. explodeComboLine() — turns a COMBO order line into a 0₺ parent grouping
 *     line + N child lines that carry the money. Children are ALWAYS
 *     quantity = 1 so the system invariant `subtotal === quantity *
 *     (unitPrice + modifierTotal)` holds trivially — every downstream
 *     (fiscal-line-builder, payByItems perUnit=subtotal/qty, reports) stays
 *     byte-consistent with zero changes to their math. The combo package price
 *     is apportioned across children in KURUŞ with largest-remainder so
 *     Σ(child.subtotal) === comboTotal exactly (no fiscal drift), and each
 *     child carries its OWN component KDV rate (correct per-line VAT).
 */

export interface CampaignPricable {
  price: unknown;
  campaignPrice?: unknown | null;
  campaignStartAt?: Date | string | null;
  campaignEndAt?: Date | string | null;
}

/** Charged price now: campaign price if the (optional) window is open, else list. */
export function resolveEffectivePrice(p: CampaignPricable, now: Date): number {
  const base = Number(p.price ?? 0);
  if (p.campaignPrice == null) return base;
  const cp = Number(p.campaignPrice);
  if (!Number.isFinite(cp) || cp < 0) return base;
  if (p.campaignStartAt && now < new Date(p.campaignStartAt)) return base;
  if (p.campaignEndAt && now > new Date(p.campaignEndAt)) return base;
  return cp;
}

export function isCampaignActive(p: CampaignPricable, now: Date): boolean {
  if (p.campaignPrice == null) return false;
  const cp = Number(p.campaignPrice);
  if (!Number.isFinite(cp) || cp < 0) return false;
  if (p.campaignStartAt && now < new Date(p.campaignStartAt)) return false;
  if (p.campaignEndAt && now > new Date(p.campaignEndAt)) return false;
  return cp < Number(p.price ?? 0); // only "active" if it actually discounts
}

// ── Combo explosion ────────────────────────────────────────────────────────

export interface ComboComponent {
  id: string; // component product id
  price: unknown;
  campaignPrice?: unknown | null;
  campaignStartAt?: Date | string | null;
  campaignEndAt?: Date | string | null;
  taxRate?: number | null;
}

export interface ComboGroupCatalog {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  items: Array<{
    componentProductId: string;
    quantity: number; // units of this component per one combo (e.g. "2 Dürüm" → 2)
    priceDelta: unknown; // ± added to the combo price when this item is chosen
    isDefault: boolean;
    component: ComboComponent;
  }>;
}

export interface ComboCatalog {
  combo: CampaignPricable & { id: string };
  groups: ComboGroupCatalog[];
}

export interface ComboSelectionInput {
  groupId: string;
  componentProductId: string;
}

export interface ExplodedChild {
  productId: string;
  quantity: 1;
  unitPrice: number;
  subtotal: number;
  modifierTotal: 0;
  taxRate: number;
  taxAmount: number;
  listUnitPrice: number;
}

export interface ExplodedCombo {
  parent: {
    productId: string;
    quantity: number;
    unitPrice: 0;
    subtotal: 0;
    modifierTotal: 0;
    taxRate: 0;
    taxAmount: 0;
    listUnitPrice: number; // Σ component list prices (for "you saved X" strikethrough)
  };
  children: ExplodedChild[];
  lineTotal: number; // Σ children.subtotal === comboTotal * comboQuantity
  lineTax: number;
}

export class ComboValidationError extends Error {}

const money = (n: number) => Math.round(n * 100) / 100;
const extractTax = (grossInclusive: number, rate: number) =>
  money((grossInclusive * rate) / (100 + rate));

/**
 * Resolve which items are chosen for each group (explicit selections, or the
 * group's defaults when the client sent none), enforce min/max, and return the
 * flat per-one-combo component list.
 */
function resolveSelections(
  catalog: ComboCatalog,
  selections: ComboSelectionInput[],
): Array<{ item: ComboGroupCatalog["items"][number] }> {
  const flat: Array<{ item: ComboGroupCatalog["items"][number] }> = [];
  for (const group of catalog.groups) {
    const forGroup = selections.filter((s) => s.groupId === group.id);
    let chosen = forGroup;
    if (chosen.length === 0) {
      // No explicit choice → apply defaults (covers fixed-content slots).
      const defaults = group.items.filter((i) => i.isDefault);
      chosen = defaults.map((i) => ({
        groupId: group.id,
        componentProductId: i.componentProductId,
      }));
    }
    if (chosen.length < group.minSelect || chosen.length > group.maxSelect) {
      throw new ComboValidationError(
        `"${group.name}" için ${group.minSelect}-${group.maxSelect} seçim gerekir (${chosen.length} geldi)`,
      );
    }
    for (const sel of chosen) {
      const item = group.items.find(
        (i) => i.componentProductId === sel.componentProductId,
      );
      if (!item) {
        throw new ComboValidationError(
          `"${group.name}" grubunda geçersiz seçenek`,
        );
      }
      flat.push({ item });
    }
  }
  if (flat.length === 0) {
    throw new ComboValidationError("Kombo en az bir bileşen içermeli");
  }
  return flat;
}

/**
 * Explode one COMBO order line (comboQuantity of the combo) into parent + qty-1
 * children with kuruş-exact apportioned prices. `now` drives campaign windows.
 */
export function explodeComboLine(
  catalog: ComboCatalog,
  selections: ComboSelectionInput[],
  comboQuantity: number,
  now: Date,
): ExplodedCombo {
  if (!Number.isInteger(comboQuantity) || comboQuantity < 1) {
    throw new ComboValidationError("Geçersiz kombo adedi");
  }
  const flat = resolveSelections(catalog, selections);

  // Combo price for ONE combo = combo effective price + Σ chosen priceDeltas.
  const comboBase = resolveEffectivePrice(catalog.combo, now);
  const deltaTotal = flat.reduce(
    (s, { item }) => s + Number(item.priceDelta || 0) * item.quantity,
    0,
  );
  const comboUnitTotal = money(comboBase + deltaTotal);

  // Build the flat qty-1 child list, expanded by per-combo quantity AND combo
  // quantity. Weight = component effective list price (pricier → bigger share
  // of the package price → correct VAT distribution).
  interface Slot {
    productId: string;
    taxRate: number;
    listUnit: number;
    weight: number;
  }
  const slots: Slot[] = [];
  const listValuePerCombo = flat.reduce((s, { item }) => {
    const listUnit = resolveEffectivePrice(item.component, now);
    return s + listUnit * item.quantity;
  }, 0);
  for (let c = 0; c < comboQuantity; c++) {
    for (const { item } of flat) {
      const listUnit = resolveEffectivePrice(item.component, now);
      for (let u = 0; u < item.quantity; u++) {
        slots.push({
          productId: item.componentProductId,
          taxRate: item.component.taxRate ?? 10,
          listUnit,
          weight: listUnit,
        });
      }
    }
  }

  // Apportion (comboUnitTotal * comboQuantity) cents across slots by weight.
  const targetCents = Math.round(comboUnitTotal * comboQuantity * 100);
  const totalWeight = slots.reduce((s, x) => s + x.weight, 0);
  const raw = slots.map((s) =>
    totalWeight > 0
      ? (targetCents * s.weight) / totalWeight
      : targetCents / slots.length,
  );
  const floors = raw.map((r) => Math.floor(r));
  let remainder = targetCents - floors.reduce((a, b) => a + b, 0);
  // Give the extra cents to the largest fractional parts (largest-remainder).
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  const cents = floors.slice();
  for (let k = 0; k < remainder; k++) cents[order[k % order.length].i] += 1;

  const children: ExplodedChild[] = slots.map((s, i) => {
    const subtotal = money(cents[i] / 100);
    return {
      productId: s.productId,
      quantity: 1,
      unitPrice: subtotal,
      subtotal,
      modifierTotal: 0,
      taxRate: s.taxRate,
      taxAmount: extractTax(subtotal, s.taxRate),
      listUnitPrice: s.listUnit,
    };
  });

  const lineTotal = money(children.reduce((s, c) => s + c.subtotal, 0));
  const lineTax = money(children.reduce((s, c) => s + c.taxAmount, 0));

  return {
    parent: {
      productId: catalog.combo.id,
      quantity: comboQuantity,
      unitPrice: 0,
      subtotal: 0,
      modifierTotal: 0,
      taxRate: 0,
      taxAmount: 0,
      listUnitPrice: money(listValuePerCombo),
    },
    children,
    lineTotal,
    lineTax,
  };
}
