import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ValidationPipe, ArgumentMetadata } from '@nestjs/common';
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

describe("CartItemDto — print3d productIds (v3.7.0)", () => {
  const base = {
    type: "service" as const,
    code: "print3d_item",
    qty: 1,
    productIds: [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ],
  };

  /**
   * main.ts's app.useGlobalPipes(...) config, verbatim. A unit test that
   * constructs the DTO directly (plainToInstance + validate) never exercises
   * this — the silent strip happens INSIDE ValidationPipe#transform, which
   * runs class-validator's `whitelist` option as a side effect of validate()
   * and returns the (possibly stripped) instance to the controller. Only a
   * real pipe.transform() call over a raw, HTTP-shaped payload proves the
   * field survives the actual request path.
   */
  const realPipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: false,
    transformOptions: {
      enableImplicitConversion: true,
    },
  });

  it("keeps productIds through the REAL app ValidationPipe (whitelist:true would otherwise silently delete it)", async () => {
    // This is the actual pipe instance shape wired up in main.ts, fed a
    // plain object exactly as it would arrive off the wire — not a DTO
    // instance constructed by the test. If `productIds` isn't declared with
    // a validation decorator on CartItemDto, class-validator's whitelist
    // strips it here with NO error, and the controller never sees it.
    const metadata: ArgumentMetadata = {
      type: "body",
      metatype: CartItemDto,
      data: "",
    };
    const result = await realPipe.transform({ ...base }, metadata);
    expect(result).toBeInstanceOf(CartItemDto);
    expect((result as CartItemDto).productIds).toEqual(base.productIds);
  });

  it("keeps productIds on a service item (whitelist:true would otherwise delete it)", async () => {
    // ValidationPipe main.ts'te whitelist:true ile kurulu: BEYAN EDİLMEMİŞ her
    // alan sessizce silinir. Alan burada beyan edilmezse dizi kaybolur ve
    // print3d_item adedi 1'e düşer — 50 figür 50 kuruşa satılır.
    const dto = plainToInstance(CartItemDto, base, {
      excludeExtraneousValues: false,
    });
    const errors = await validate(dto, { whitelist: true });
    expect(errors).toHaveLength(0);
    expect(dto.productIds).toEqual(base.productIds);
  });

  it("rejects a non-UUID entry in productIds", async () => {
    const dto = plainToInstance(CartItemDto, {
      ...base,
      productIds: ["not-a-uuid"],
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain("productIds");
  });

  it("rejects more than 50 productIds", async () => {
    const many = Array.from(
      { length: 51 },
      (_, i) => `1111111${String(i).padStart(4, "0")}-1111-4111-8111-111111111111`,
    );
    const dto = plainToInstance(CartItemDto, { ...base, productIds: many });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain("productIds");
  });
});
