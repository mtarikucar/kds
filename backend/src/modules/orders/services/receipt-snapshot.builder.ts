import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Bumped when the snapshot shape changes in a non-additive way (renamed or
 * removed fields, semantic changes). Phase 1.3's Rust ESC/POS layer will
 * branch on this. Additive optional fields don't require a bump.
 */
export const RECEIPT_SNAPSHOT_VERSION = 1 as const;

type DecimalLike = Prisma.Decimal | string | number;

const fmt = (value: DecimalLike | null | undefined): string =>
  new Prisma.Decimal(value ?? 0).toFixed(2);

export interface ReceiptSnapshotV1 {
  version: 1;
  restaurant: {
    name: string;
    currency: string;
  };
  order: {
    id: string;
    orderNumber: string;
    type: string;
    tableNumber: string | null;
    notes: string | null;
  };
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: string;
    totalPrice: string;
    modifiers: string[];
    notes: string | null;
  }>;
  totals: {
    subtotal: string;
    tax: string;
    discount: string;
    total: string;
  };
  payment: {
    method: string;
    transactionId: string | null;
    paidAt: string;
  };
  printedAt: string;
}

export interface KitchenTicketSnapshotV1 {
  version: 1;
  order: {
    id: string;
    orderNumber: string;
    type: string;
    tableNumber: string | null;
  };
  items: Array<{
    name: string;
    quantity: number;
    modifiers: string[];
    notes: string | null;
  }>;
  specialInstructions: string | null;
  createdAt: string;
}

interface TenantInput {
  id: string;
  name: string;
  currency: string;
}

interface OrderItemInput {
  quantity: number;
  unitPrice: DecimalLike;
  totalPrice: DecimalLike;
  notes: string | null;
  product: { name: string };
  modifiers: Array<{ name: string }>;
}

interface OrderInput {
  id: string;
  orderNumber: string;
  type: string;
  totalAmount: DecimalLike;
  taxAmount: DecimalLike;
  discount: DecimalLike;
  finalAmount: DecimalLike;
  notes: string | null;
  createdAt: Date;
  table: { number: string } | null;
  orderItems: OrderItemInput[];
}

interface PaymentInput {
  method: string;
  transactionId: string | null;
  paidAt: Date | null;
}

@Injectable()
export class ReceiptSnapshotBuilder {
  buildReceiptSnapshot(args: {
    tenant: TenantInput;
    order: OrderInput;
    payment: PaymentInput;
  }): ReceiptSnapshotV1 {
    const { tenant, order, payment } = args;

    return {
      version: RECEIPT_SNAPSHOT_VERSION,
      restaurant: {
        name: tenant.name,
        currency: tenant.currency,
      },
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        type: order.type,
        tableNumber: order.table?.number ?? null,
        notes: order.notes,
      },
      items: order.orderItems.map((item) => ({
        name: item.product.name,
        quantity: item.quantity,
        unitPrice: fmt(item.unitPrice),
        totalPrice: fmt(item.totalPrice),
        modifiers: item.modifiers.map((m) => m.name),
        notes: item.notes ?? null,
      })),
      totals: {
        subtotal: fmt(order.totalAmount),
        tax: fmt(order.taxAmount),
        discount: fmt(order.discount),
        total: fmt(order.finalAmount),
      },
      payment: {
        method: payment.method,
        transactionId: payment.transactionId ?? null,
        paidAt: (payment.paidAt ?? new Date()).toISOString(),
      },
      printedAt: new Date().toISOString(),
    };
  }

  /**
   * Adapter from the schema-shape order (with `OrderItem.subtotal` and
   * nested `OrderItemModifier.modifier`) to this builder's flatter
   * `OrderInput` contract. Centralized here so payments + orders services
   * don't drift if the schema evolves.
   *
   * The caller is responsible for ensuring the prisma include pulled in
   * `orderItems.modifiers.modifier` and `table` — without those the
   * adapter still works but the snapshot will have empty modifiers and
   * a null tableNumber.
   */
  static toBuilderOrder(orderRow: any): OrderInput {
    return {
      ...orderRow,
      orderItems: (orderRow.orderItems ?? []).map((oi: any) => ({
        ...oi,
        totalPrice: oi.subtotal,
        modifiers: (oi.modifiers ?? []).map((om: any) => ({
          name: om.modifier?.name ?? '',
        })),
      })),
    };
  }

  buildKitchenTicketSnapshot(args: {
    order: OrderInput;
  }): KitchenTicketSnapshotV1 {
    const { order } = args;

    return {
      version: RECEIPT_SNAPSHOT_VERSION,
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        type: order.type,
        tableNumber: order.table?.number ?? null,
      },
      items: order.orderItems.map((item) => ({
        name: item.product.name,
        quantity: item.quantity,
        modifiers: item.modifiers.map((m) => m.name),
        notes: item.notes ?? null,
      })),
      specialInstructions: order.notes ?? null,
      createdAt: order.createdAt.toISOString(),
    };
  }
}
