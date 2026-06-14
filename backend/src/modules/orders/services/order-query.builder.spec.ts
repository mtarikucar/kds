import {
  ORDER_DETAIL_INCLUDE,
  buildFindAllWhere,
} from "./order-query.builder";
import { OrderStatus } from "../../../common/constants/order-status.enum";
import { BranchScope } from "../../../common/scoping/branch-scope";

/**
 * Characterizes the pure read-path query/include builders extracted VERBATIM
 * from OrdersService.findAll / findOne / findOneByTenant. Pins the exact
 * WHERE assembly (so the branch-scope leak fix + single-vs-`in` status
 * collapse + date-window can't silently regress) and the shared include
 * projection shape (so a schema change touches one literal, not three).
 */
describe("order-query.builder", () => {
  const SCOPE: BranchScope = {
    tenantId: "tenant-1",
    branchId: "branch-1",
  } as BranchScope;

  describe("buildFindAllWhere", () => {
    it("spreads the branch-scope compound (tenantId + branchId) with no extra filters", () => {
      const where = buildFindAllWhere(SCOPE);
      expect(where).toEqual({ tenantId: "tenant-1", branchId: "branch-1" });
    });

    it("adds tableId when provided", () => {
      const where = buildFindAllWhere(SCOPE, "table-9");
      expect(where.tableId).toBe("table-9");
    });

    it("uses a bare equality for a single status", () => {
      const where = buildFindAllWhere(SCOPE, undefined, [OrderStatus.PAID]);
      expect(where.status).toBe(OrderStatus.PAID);
    });

    it("uses an `in` filter for multiple statuses", () => {
      const where = buildFindAllWhere(SCOPE, undefined, [
        OrderStatus.PENDING,
        OrderStatus.PREPARING,
      ]);
      expect(where.status).toEqual({
        in: [OrderStatus.PENDING, OrderStatus.PREPARING],
      });
    });

    it("ignores an empty status array (no status filter)", () => {
      const where = buildFindAllWhere(SCOPE, undefined, []);
      expect(where.status).toBeUndefined();
    });

    it("builds a gte-only createdAt window when only startDate is given", () => {
      const start = new Date("2026-01-01T00:00:00Z");
      const where = buildFindAllWhere(SCOPE, undefined, undefined, start);
      expect(where.createdAt).toEqual({ gte: start });
    });

    it("builds an lte-only createdAt window when only endDate is given", () => {
      const end = new Date("2026-02-01T00:00:00Z");
      const where = buildFindAllWhere(
        SCOPE,
        undefined,
        undefined,
        undefined,
        end,
      );
      expect(where.createdAt).toEqual({ lte: end });
    });

    it("builds a gte/lte window when both dates are given", () => {
      const start = new Date("2026-01-01T00:00:00Z");
      const end = new Date("2026-02-01T00:00:00Z");
      const where = buildFindAllWhere(
        SCOPE,
        undefined,
        undefined,
        start,
        end,
      );
      expect(where.createdAt).toEqual({ gte: start, lte: end });
    });

    it("does not add a createdAt key when no dates are given", () => {
      const where = buildFindAllWhere(SCOPE);
      expect(where.createdAt).toBeUndefined();
    });

    it("composes all filters together", () => {
      const start = new Date("2026-01-01T00:00:00Z");
      const where = buildFindAllWhere(
        SCOPE,
        "table-2",
        [OrderStatus.SERVED],
        start,
      );
      expect(where).toEqual({
        tenantId: "tenant-1",
        branchId: "branch-1",
        tableId: "table-2",
        status: OrderStatus.SERVED,
        createdAt: { gte: start },
      });
    });
  });

  describe("ORDER_DETAIL_INCLUDE", () => {
    it("includes the orderItems → product/modifier projections", () => {
      expect(ORDER_DETAIL_INCLUDE.orderItems).toEqual({
        include: {
          product: {
            select: { id: true, name: true, price: true, image: true },
          },
          modifiers: {
            include: {
              modifier: {
                select: { id: true, name: true, priceAdjustment: true },
              },
            },
          },
        },
      });
    });

    it("includes table, user, and payments projections", () => {
      expect(ORDER_DETAIL_INCLUDE.table).toEqual({
        select: { id: true, number: true, section: true },
      });
      expect(ORDER_DETAIL_INCLUDE.user).toEqual({
        select: { id: true, firstName: true, lastName: true },
      });
      expect(ORDER_DETAIL_INCLUDE.payments).toBe(true);
    });

    it("is frozen so callers cannot mutate the shared literal", () => {
      expect(Object.isFrozen(ORDER_DETAIL_INCLUDE)).toBe(true);
    });
  });
});
