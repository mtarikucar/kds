import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProductDto } from './create-product.dto';
import { CreateCategoryDto } from './create-category.dto';

/**
 * Iter-57 regressions for menu product/category DTOs.
 *
 * Before this fix:
 *  - price had @Min(0) but no @Max — schema is Decimal(10, 2) so any
 *    value above 99,999,999.99 surfaced as a 500 from Postgres, plus
 *    multi-quantity Order.totalAmount math could overflow even on
 *    technically-representable per-unit values.
 *  - name / description had no @MaxLength — both columns are Postgres
 *    TEXT with no implicit ceiling.
 *  - `image` accepted any string. Modern browsers ignore `javascript:`
 *    on <img src>, but the legacy column is also dereferenced by the
 *    public QR menu page and reused by social-share previews. Reject
 *    non-http(s)/non-rooted schemes at validation time.
 *  - imageIds was an unbounded @IsString array. attachImagesToProduct
 *    runs one update inside a $transaction per id; an unbounded array
 *    is a DoS lever against the API process.
 *  - categoryId was bare @IsString — non-UUID strings slipped through.
 */
describe('Menu DTOs (iter-57)', () => {
  async function errors(dto: object): Promise<string[]> {
    const results = await validate(dto);
    return results.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  describe('CreateProductDto', () => {
    const base = {
      name: 'Grilled Chicken',
      price: 12.99,
      categoryId: '550e8400-e29b-41d4-a716-446655440000',
    };

    it('accepts a typical product payload', async () => {
      const dto = plainToInstance(CreateProductDto, base);
      expect(await errors(dto)).toEqual([]);
    });

    it('rejects price above the cap', async () => {
      const dto = plainToInstance(CreateProductDto, { ...base, price: 10_000_001 });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /price/i.test(m))).toBe(true);
    });

    it('rejects Number.MAX_SAFE_INTEGER on price — the Decimal(10,2) overflow guard', async () => {
      const dto = plainToInstance(CreateProductDto, { ...base, price: Number.MAX_SAFE_INTEGER });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /price/i.test(m))).toBe(true);
    });

    it('rejects name longer than 200 chars', async () => {
      const dto = plainToInstance(CreateProductDto, { ...base, name: 'x'.repeat(201) });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /name/i.test(m))).toBe(true);
    });

    it('rejects description longer than 5000 chars', async () => {
      const dto = plainToInstance(CreateProductDto, { ...base, description: 'y'.repeat(5001) });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /description/i.test(m))).toBe(true);
    });

    it('rejects javascript: URL on image (XSS-shaped scheme)', async () => {
      const dto = plainToInstance(CreateProductDto, { ...base, image: 'javascript:alert(1)' });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /image/i.test(m))).toBe(true);
    });

    it('rejects data: URL on image (big-blob exfil/DoS shape)', async () => {
      const dto = plainToInstance(CreateProductDto, {
        ...base,
        image: 'data:image/png;base64,iVBOR',
      });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /image/i.test(m))).toBe(true);
    });

    it('accepts a normal http(s) image URL', async () => {
      const dto = plainToInstance(CreateProductDto, {
        ...base,
        image: 'https://cdn.example.com/grilled.webp',
      });
      expect(await errors(dto)).toEqual([]);
    });

    it('accepts a /-rooted self-hosted image path', async () => {
      const dto = plainToInstance(CreateProductDto, { ...base, image: '/products/foo.webp' });
      expect(await errors(dto)).toEqual([]);
    });

    it('rejects a non-UUID categoryId', async () => {
      const dto = plainToInstance(CreateProductDto, { ...base, categoryId: 'not-a-uuid' });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /categoryId/i.test(m))).toBe(true);
    });

    it('rejects an imageIds array larger than 20', async () => {
      const ids = Array.from({ length: 21 }, (_, i) =>
        `550e8400-e29b-41d4-a716-${String(i).padStart(12, '0')}`,
      );
      const dto = plainToInstance(CreateProductDto, { ...base, imageIds: ids });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /imageIds/i.test(m))).toBe(true);
    });

    it('rejects currentStock above 1,000,000', async () => {
      const dto = plainToInstance(CreateProductDto, { ...base, currentStock: 1_000_001 });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /currentStock/i.test(m))).toBe(true);
    });
  });

  describe('CreateCategoryDto', () => {
    it('accepts a typical category', async () => {
      const dto = plainToInstance(CreateCategoryDto, { name: 'Main Dishes' });
      expect(await errors(dto)).toEqual([]);
    });

    it('rejects name longer than 100 chars', async () => {
      const dto = plainToInstance(CreateCategoryDto, { name: 'x'.repeat(101) });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /name/i.test(m))).toBe(true);
    });

    it('rejects description longer than 2000 chars', async () => {
      const dto = plainToInstance(CreateCategoryDto, {
        name: 'Main Dishes',
        description: 'y'.repeat(2001),
      });
      const msgs = await errors(dto);
      expect(msgs.some((m) => /description/i.test(m))).toBe(true);
    });
  });
});
