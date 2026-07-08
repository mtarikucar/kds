import type { Product, ComboSelectionInput } from '../../types';
import type { SelectedModifier } from '../../components/pos/ProductOptionsModal';

/** POS top-level view: table-selection grid or the order screen. */
export type POSView = 'table-selection' | 'order';

/**
 * A line in the POS cart: a Product spread with a quantity, optional notes,
 * and optional selected modifiers. Shared between POSPage and its hooks.
 */
export interface CartItem extends Product {
  quantity: number;
  notes?: string;
  modifiers?: SelectedModifier[];
  // For a COMBO line: the chosen component per slot. `price` on this item is
  // already the effective combo price (base + chosen slot deltas).
  comboSelections?: ComboSelectionInput[];
}
