import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCustomerOrderDto } from './create-customer-order.dto';

/**
 * Iter-84 regression for the public QR-menu order DTO. Pre-fix:
 *
 *  - productId / modifierId / tableId were bare @IsString. Non-UUID
 *    strings slipped to Prisma which silently no-matched, surfacing
 *    as the misleading "Product not found" / "Table not found"
 *    instead of a clean 400.
 *  - latitude / longitude were @IsNumber with no range bounds. A
 *    client posting latitude: 1e30 flowed into the haversine math in
 *    isLocationWithinRange and produced NaN distance (accidentally
 *    passes the "within range" check) or garbage values.
 *
 * iter-84 tightens to @IsUUID + lat[-90, 90] + lon[-180, 180].
 */
describe('CreateCustomerOrderDto (iter-84)', () => {
  async function errors(dto: object): Promise<string[]> {
    const results = await validate(dto);
    return results.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  const realisticItem = {
    productId: '550e8400-e29b-41d4-a716-446655440000',
    quantity: 1,
  };
  const validBody = {
    sessionId: 'a'.repeat(64),
    items: [realisticItem],
  };

  it('accepts a realistic order payload', async () => {
    const dto = plainToInstance(CreateCustomerOrderDto, validBody);
    expect(await errors(dto)).toEqual([]);
  });

  it('rejects a non-UUID productId on items[]', async () => {
    const dto = plainToInstance(CreateCustomerOrderDto, {
      ...validBody,
      items: [{ productId: 'not-a-uuid', quantity: 1 }],
    });
    const all = await validate(dto);
    expect(all.length).toBeGreaterThan(0);
  });

  it('rejects a non-UUID modifierId on items[].modifiers', async () => {
    const dto = plainToInstance(CreateCustomerOrderDto, {
      ...validBody,
      items: [
        {
          productId: '550e8400-e29b-41d4-a716-446655440000',
          quantity: 1,
          modifiers: [{ modifierId: 'not-a-uuid', quantity: 1 }],
        },
      ],
    });
    const all = await validate(dto);
    expect(all.length).toBeGreaterThan(0);
  });

  it('rejects a non-UUID tableId', async () => {
    const dto = plainToInstance(CreateCustomerOrderDto, {
      ...validBody,
      tableId: 'totally-not-a-uuid',
    });
    const msgs = await errors(dto);
    expect(msgs.some((m) => /tableId/i.test(m))).toBe(true);
  });

  it('accepts latitude inside [-90, 90]', async () => {
    const dto = plainToInstance(CreateCustomerOrderDto, {
      ...validBody,
      latitude: 41.0082,
      longitude: 28.9784,
    });
    expect(await errors(dto)).toEqual([]);
  });

  it('rejects latitude above 90 (the load-bearing haversine guard)', async () => {
    const dto = plainToInstance(CreateCustomerOrderDto, {
      ...validBody,
      latitude: 91,
      longitude: 0,
    });
    const msgs = await errors(dto);
    expect(msgs.some((m) => /latitude/i.test(m))).toBe(true);
  });

  it('rejects longitude outside [-180, 180]', async () => {
    const dto = plainToInstance(CreateCustomerOrderDto, {
      ...validBody,
      latitude: 0,
      longitude: 200,
    });
    const msgs = await errors(dto);
    expect(msgs.some((m) => /longitude/i.test(m))).toBe(true);
  });

  it('rejects 1e30 latitude (the catastrophic-NaN-distance guard)', async () => {
    const dto = plainToInstance(CreateCustomerOrderDto, {
      ...validBody,
      latitude: 1e30,
      longitude: 0,
    });
    const msgs = await errors(dto);
    expect(msgs.some((m) => /latitude/i.test(m))).toBe(true);
  });

  /**
   * Iter-85 regression. Pre-fix sessionId was @Length(32, 128) — any
   * 32-128 char string passed. The actual session token shape is
   * randomBytes(32).toString('hex') = exactly 64 lower-hex chars.
   * Tight regex stops typos / spoofing at the DTO layer instead of
   * letting them through to a DB lookup that no-matches.
   */
  describe('sessionId hex-shape gate (iter-85)', () => {
    it('accepts a realistic 64-char lower-hex sessionId', async () => {
      const dto = plainToInstance(CreateCustomerOrderDto, {
        ...validBody,
        sessionId: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      });
      expect(await errors(dto)).toEqual([]);
    });

    it('rejects a 63-char string (one short of the canonical length)', async () => {
      const dto = plainToInstance(CreateCustomerOrderDto, {
        ...validBody,
        sessionId: 'a'.repeat(63),
      });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /sessionId/i.test(m))).toBe(true);
    });

    it('rejects a 64-char string with non-hex chars (load-bearing shape gate)', async () => {
      // Uppercase G is not in [0-9a-f]; pre-iter-85 this would have
      // passed @Length(32, 128) and reached the DB lookup.
      const dto = plainToInstance(CreateCustomerOrderDto, {
        ...validBody,
        sessionId: 'G'.repeat(64),
      });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /sessionId/i.test(m))).toBe(true);
    });

    it('rejects a 128-char string (the old loose upper bound)', async () => {
      const dto = plainToInstance(CreateCustomerOrderDto, {
        ...validBody,
        sessionId: 'a'.repeat(128),
      });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /sessionId/i.test(m))).toBe(true);
    });
  });
});
