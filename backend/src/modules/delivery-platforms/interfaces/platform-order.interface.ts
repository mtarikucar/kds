import { DeliveryPlatform } from '../constants/platform.enum';

export interface NormalizedOrderItem {
  externalItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  notes?: string;
  modifiers?: NormalizedOrderModifier[];
}

export interface NormalizedOrderModifier {
  name: string;
  price: number;
  quantity: number;
}

export interface NormalizedOrder {
  platform: DeliveryPlatform;
  externalOrderId: string;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  notes?: string;
  items: NormalizedOrderItem[];
  totalAmount: number;
  discount: number;
  finalAmount: number;
  rawPayload: Record<string, any>;
  createdAt?: Date;
}
