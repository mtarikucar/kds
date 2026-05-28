import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';
import { CheckoutController } from '../checkout.controller';
import { CartDto, CartItemDto, ConfirmCheckoutDto } from './cart.dto';

/**
 * Iter-88 regression for the checkout DTOs and controller decoration.
 *
 * Pre-fix:
 *   - `quote`/`start`/`confirm` accepted `@Body() cart: Cart` where Cart was
 *     a TypeScript interface, so ValidationPipe was a no-op. A WAITER could
 *     POST `{ items: [{ type: 'plan', code: 'BUSINESS' }] }` and the request
 *     reached the service unfiltered.
 *   - `confirm` accepted `paymentRef: string` from the client and stored it
 *     verbatim, with no length cap and no non-empty guard. Empty string +
 *     `if (paymentRef)` falsiness check let the idempotency guard be
 *     bypassed (empty string → fresh provisioning).
 *   - `start`/`confirm` only carried JwtAuthGuard, no @Roles — any tenant
 *     role (WAITER, KITCHEN, CASHIER) could trigger provisioning.
 *
 * Iter-88 introduces CartDto / CartItemDto / ConfirmCheckoutDto and adds
 * @Roles(ADMIN, MANAGER) on /start and /confirm.
 */
describe('CartDto / ConfirmCheckoutDto (iter-88)', () => {
  async function errors(dto: object): Promise<string[]> {
    const results = await validate(dto);
    return results.flatMap((e) => {
      const own = Object.values(e.constraints ?? {});
      const nested = (e.children ?? []).flatMap((c) =>
        Object.values(c.constraints ?? {}).concat(
          (c.children ?? []).flatMap((cc) => Object.values(cc.constraints ?? {})),
        ),
      );
      return [...own, ...nested];
    });
  }

  const validPlanItem = {
    type: 'plan' as const,
    code: 'PRO',
    billingCycle: 'MONTHLY' as const,
  };
  const validHardwareItem = {
    type: 'hardware' as const,
    sku: 'yazarkasa-hugin-tiger-t300',
    qty: 1,
  };

  describe('CartItemDto', () => {
    it('accepts a realistic plan line', async () => {
      const dto = plainToInstance(CartItemDto, validPlanItem);
      expect(await errors(dto)).toEqual([]);
    });

    it('accepts a realistic hardware line', async () => {
      const dto = plainToInstance(CartItemDto, validHardwareItem);
      expect(await errors(dto)).toEqual([]);
    });

    it('rejects an unknown item type', async () => {
      const dto = plainToInstance(CartItemDto, { type: 'subscription' });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /type/i.test(m))).toBe(true);
    });

    it('rejects qty above the 999 cap (the bulk-order sales gate)', async () => {
      const dto = plainToInstance(CartItemDto, { ...validHardwareItem, qty: 10000 });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /qty/i.test(m))).toBe(true);
    });

    it('rejects qty below 1', async () => {
      const dto = plainToInstance(CartItemDto, { ...validHardwareItem, qty: 0 });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /qty/i.test(m))).toBe(true);
    });

    it('rejects an unknown billingCycle', async () => {
      const dto = plainToInstance(CartItemDto, {
        ...validPlanItem,
        billingCycle: 'WEEKLY',
      });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /billingCycle/i.test(m))).toBe(true);
    });

    it('rejects an unknown acquisition mode', async () => {
      const dto = plainToInstance(CartItemDto, {
        ...validHardwareItem,
        acquisition: 'lease',
      });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /acquisition/i.test(m))).toBe(true);
    });

    it('rejects a non-UUID branchId', async () => {
      const dto = plainToInstance(CartItemDto, {
        type: 'addon',
        code: 'multi_branch',
        branchId: 'not-a-uuid',
      });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /branchId/i.test(m))).toBe(true);
    });

    it('caps code length so a megabyte payload cannot land in checkout', async () => {
      const dto = plainToInstance(CartItemDto, {
        type: 'plan',
        code: 'A'.repeat(10_000),
      });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /code/i.test(m))).toBe(true);
    });
  });

  describe('CartDto', () => {
    it('accepts a realistic single-item cart', async () => {
      const dto = plainToInstance(CartDto, { items: [validPlanItem] });
      expect(await errors(dto)).toEqual([]);
    });

    it('rejects an empty items array', async () => {
      const dto = plainToInstance(CartDto, { items: [] });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /items/i.test(m))).toBe(true);
    });

    it('rejects more than 50 items (the per-cart quote-engine cap)', async () => {
      const items = Array.from({ length: 51 }, () => ({ ...validHardwareItem }));
      const dto = plainToInstance(CartDto, { items });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /items/i.test(m))).toBe(true);
    });

    it('rejects when ONE nested item is malformed', async () => {
      // Pre-iter-88 the bare TS interface accepted this with type='nope';
      // the engine would just hit the final `if` branch and silently no-op.
      const dto = plainToInstance(CartDto, {
        items: [validPlanItem, { type: 'nope' }],
      });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /type/i.test(m))).toBe(true);
    });

    it('rejects a non-object shippingAddress', async () => {
      const dto = plainToInstance(CartDto, {
        items: [validHardwareItem],
        shippingAddress: 'just-a-string',
      });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /shippingAddress/i.test(m))).toBe(true);
    });
  });

  describe('ConfirmCheckoutDto', () => {
    const validCart = { items: [validHardwareItem] };

    it('accepts a realistic cart + paymentRef', async () => {
      const dto = plainToInstance(ConfirmCheckoutDto, {
        cart: validCart,
        paymentRef: 'SUB-tenant-1740000000000',
      });
      expect(await errors(dto)).toEqual([]);
    });

    it('rejects an empty paymentRef (the load-bearing idempotency-bypass guard)', async () => {
      // Pre-iter-88: empty string + `if (paymentRef)` falsiness check meant
      // the idempotency lookup was skipped, so '' would always fall through
      // to fresh provisioning. Now empty fails @IsNotEmpty at the boundary.
      const dto = plainToInstance(ConfirmCheckoutDto, {
        cart: validCart,
        paymentRef: '',
      });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /paymentRef/i.test(m))).toBe(true);
    });

    it('rejects a missing paymentRef', async () => {
      const dto = plainToInstance(ConfirmCheckoutDto, { cart: validCart });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /paymentRef/i.test(m))).toBe(true);
    });

    it('caps paymentRef at 128 chars so a megabyte cannot land on the row', async () => {
      const dto = plainToInstance(ConfirmCheckoutDto, {
        cart: validCart,
        paymentRef: 'x'.repeat(200),
      });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /paymentRef/i.test(m))).toBe(true);
    });

    it('rejects an empty cart even when paymentRef is fine', async () => {
      const dto = plainToInstance(ConfirmCheckoutDto, {
        cart: { items: [] },
        paymentRef: 'SUB-tenant-1',
      });
      const msgs = await errors(dto);
      expect(msgs.length).toBeGreaterThan(0);
    });
  });

  /**
   * The /confirm + /start endpoints need to carry @Roles(ADMIN, MANAGER).
   * Reflect.getMetadata reads the decorator output without instantiating
   * the controller, so this catches a regression where someone strips the
   * decorator (the most likely failure mode given the iter-88 history).
   */
  describe('CheckoutController role guards', () => {
    it('start carries @Roles(ADMIN, MANAGER)', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, CheckoutController.prototype.start);
      expect(roles).toEqual(expect.arrayContaining([UserRole.ADMIN, UserRole.MANAGER]));
    });

    it('confirm carries @Roles(ADMIN, MANAGER)', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, CheckoutController.prototype.confirm);
      expect(roles).toEqual(expect.arrayContaining([UserRole.ADMIN, UserRole.MANAGER]));
    });

    it('quote stays open to any authenticated user (no @Roles)', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, CheckoutController.prototype.quote);
      // Read-only pricing — any tenant role is OK.
      expect(roles).toBeUndefined();
    });
  });
});
