import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { UserRole } from "../../../common/constants/roles.enum";
import { SubscriptionController } from "./subscription.controller";
import { InvoiceController } from "./invoice.controller";

/**
 * Security regression — billing MUTATIONS must be ADMIN-only.
 *
 * subscription.controller.ts and invoice.controller.ts previously carried
 * `@Roles(UserRole.ADMIN, UserRole.MANAGER)` on their money-mutating
 * endpoints (create / update / change-plan / cancel-scheduled-downgrade /
 * cancel / reactivate / generate-pdf). A MANAGER could therefore cancel a
 * subscription, switch plans, cancel an ADMIN-scheduled downgrade, or
 * regenerate invoice PDFs — billing actions that should require an ADMIN.
 *
 * These tests drive the REAL `RolesGuard` against the REAL controller
 * method handlers, reading the actual `@Roles(...)` metadata off each
 * handler via a real `Reflector` — exactly what NestJS does at request
 * time (the guard inspects `context.getHandler()` / `getClass()`). So the
 * assertions pin the literal decorators on the shipped controllers.
 */

const reflector = new Reflector();
const guard = new RolesGuard(reflector);

// Real controller instances. Services are irrelevant here — the guard runs
// BEFORE the handler body and never touches them — so `null` stubs suffice.
const subCtrl = new SubscriptionController(
  null as any,
  null as any,
  null as any,
);
const invCtrl = new InvoiceController(null as any, null as any);

/**
 * Build an ExecutionContext whose getHandler()/getClass() point at the
 * real controller method + class, so the guard reads the genuine @Roles
 * metadata. `user.role` is the role under test.
 */
function ctxFor(
  controllerInstance: object,
  controllerClass: any,
  methodName: string,
  role: UserRole | null,
): ExecutionContext {
  return {
    getHandler: () => (controllerInstance as any)[methodName],
    getClass: () => controllerClass,
    switchToHttp: () => ({
      getRequest: () => ({ user: role ? { role } : null }),
    }),
  } as any;
}

describe("Billing mutations are ADMIN-only (security)", () => {
  describe("SubscriptionController mutation endpoints", () => {
    const mutationMethods = [
      "createSubscription", // @Post()
      "updateSubscription", // @Patch(":id")
      "changePlan", // @Post(":id/change-plan")
      "cancelScheduledDowngrade", // @Delete(":id/scheduled-downgrade")
      "cancelSubscription", // @Post(":id/cancel")
      "reactivateSubscription", // @Post(":id/reactivate")
    ];

    it.each(mutationMethods)("FORBIDS a MANAGER from %s", (method) => {
      const ctx = ctxFor(
        subCtrl,
        SubscriptionController,
        method,
        UserRole.MANAGER,
      );
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it.each(mutationMethods)("ALLOWS an ADMIN to %s", (method) => {
      const ctx = ctxFor(
        subCtrl,
        SubscriptionController,
        method,
        UserRole.ADMIN,
      );
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe("InvoiceController mutation endpoint", () => {
    it("FORBIDS a MANAGER from generatePdf", () => {
      const ctx = ctxFor(
        invCtrl,
        InvoiceController,
        "generatePdf",
        UserRole.MANAGER,
      );
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it("ALLOWS an ADMIN to generatePdf", () => {
      const ctx = ctxFor(
        invCtrl,
        InvoiceController,
        "generatePdf",
        UserRole.ADMIN,
      );
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  /**
   * READ endpoints stay open to MANAGER — a MANAGER may still VIEW billing,
   * only mutations are locked down. These guard against an over-narrowing
   * regression where the fix accidentally strips MANAGER from GETs too.
   */
  describe("Billing READ endpoints still allow MANAGER", () => {
    it("ALLOWS a MANAGER to getCurrentSubscription (GET /current)", () => {
      const ctx = ctxFor(
        subCtrl,
        SubscriptionController,
        "getCurrentSubscription",
        UserRole.MANAGER,
      );
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it("ALLOWS a MANAGER to getScheduledDowngrade (GET /:id/scheduled-downgrade)", () => {
      const ctx = ctxFor(
        subCtrl,
        SubscriptionController,
        "getScheduledDowngrade",
        UserRole.MANAGER,
      );
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it("ALLOWS a MANAGER to getTenantInvoices (GET /tenant/invoices)", () => {
      const ctx = ctxFor(
        subCtrl,
        SubscriptionController,
        "getTenantInvoices",
        UserRole.MANAGER,
      );
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it("ALLOWS a MANAGER to getInvoice (GET /invoices/:id)", () => {
      const ctx = ctxFor(
        invCtrl,
        InvoiceController,
        "getInvoice",
        UserRole.MANAGER,
      );
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it("ALLOWS a MANAGER to downloadInvoice (GET /invoices/:id/download)", () => {
      const ctx = ctxFor(
        invCtrl,
        InvoiceController,
        "downloadInvoice",
        UserRole.MANAGER,
      );
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });
});
