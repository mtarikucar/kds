import type { Product } from '../../types';
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
}
