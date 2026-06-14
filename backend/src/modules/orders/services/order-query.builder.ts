import { Prisma } from "@prisma/client";
import { OrderStatus } from "../../../common/constants/order-status.enum";
import { BranchScope, branchScope } from "../../../common/scoping/branch-scope";

/**
 * SEPARATION OF CONCERNS — pure, side-effect-free read-path query/include
 * builders lifted VERBATIM out of OrdersService's findAll / findOne /
 * findOneByTenant. These are deterministic shape-only helpers with NO
 * Prisma client, NO $transaction, and NO DB access; OrdersService still
 * owns every query execution. Extracting them gives the three read methods
 * a single source of truth for the order-detail `include` shape (they were
 * three byte-identical literals) and isolates the findAll WHERE assembly so
 * it's unit-testable without a DB.
 */

/**
 * The order-detail `include` shape shared by findAll / findOne /
 * findOneByTenant. Was duplicated verbatim across all three; one constant
 * keeps the read projections from drifting apart on a future schema change.
 *
 * Frozen so a caller can't accidentally mutate the shared literal (Prisma
 * never mutates the include it receives, but a defensive guard is cheap).
 */
export const ORDER_DETAIL_INCLUDE = Object.freeze({
  orderItems: {
    include: {
      product: {
        select: {
          id: true,
          name: true,
          price: true,
          image: true,
        },
      },
      modifiers: {
        include: {
          modifier: {
            select: {
              id: true,
              name: true,
              priceAdjustment: true,
            },
          },
        },
      },
    },
  },
  table: {
    select: {
      id: true,
      number: true,
      section: true,
    },
  },
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  },
  payments: true,
}) satisfies Prisma.OrderInclude;

/**
 * Assemble the findAll WHERE filter VERBATIM from the original inline code:
 * branch-scope compound (tenantId, branchId), optional tableId, optional
 * single-or-`in` status filter, and an optional createdAt gte/lte window.
 * Returned as `any` to match the original `const where: any` declaration so
 * Prisma's deep-conditional WHERE typing stays out of the call site (no
 * behaviour change).
 */
export function buildFindAllWhere(
  scope: BranchScope,
  tableId?: string,
  statuses?: OrderStatus[],
  startDate?: Date,
  endDate?: Date,
): any {
  // v3.0.0 — branchScope spreads `{ tenantId, branchId }`. Pre-v3
  // this filtered by tenantId only; the v3 audit flagged the leak
  // where a MANAGER in branch A could enumerate branch B's order
  // history via GET /orders. The (tenantId, branchId) compound is
  // also a covering index entry on the Order table.
  const where: any = { ...branchScope(scope) };

  if (tableId) {
    where.tableId = tableId;
  }

  if (statuses && statuses.length > 0) {
    // Support both single status and multiple statuses
    if (statuses.length === 1) {
      where.status = statuses[0];
    } else {
      where.status = { in: statuses };
    }
  }

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) {
      where.createdAt.gte = startDate;
    }
    if (endDate) {
      where.createdAt.lte = endDate;
    }
  }

  return where;
}
