import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateHardwareProductDto } from './create-hardware-product.dto';
import { ReceiveStockDto } from './receive-stock.dto';

/**
 * Iter-48 regressions: persisted columns on the hardware-catalog
 * surface must be bounded so a hostile superadmin cannot stuff
 * multi-MB blobs into shared rows that every public-storefront load
 * re-serializes.
 */
describe('Catalog DTO length caps (iter-48)', () => {
  async function validateDto(cls: any, input: Record<string, unknown>): Promise<string[]> {
    const dto = plainToInstance(cls, input) as object;
    const errors = await validate(dto);
    return errors.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  describe('CreateHardwareProductDto', () => {
    const base = {
      sku: 'pos-test-001',
      category: 'pos_terminal',
      name: 'Test POS Terminal',
      priceCents: 100000,
    };

    it('accepts a normal product', async () => {
      expect(await validateDto(CreateHardwareProductDto, base)).toEqual([]);
    });

    it('rejects name > 200', async () => {
      const msgs = await validateDto(CreateHardwareProductDto, {
        ...base,
        name: 'a'.repeat(201),
      });
      expect(msgs.length).toBeGreaterThan(0);
    });

    it('rejects description > 5000', async () => {
      const msgs = await validateDto(CreateHardwareProductDto, {
        ...base,
        description: 'a'.repeat(5001),
      });
      expect(msgs.length).toBeGreaterThan(0);
    });

    it('rejects images array > 20', async () => {
      const images = Array.from({ length: 21 }, (_, i) => `/products/test-${i}.webp`);
      const msgs = await validateDto(CreateHardwareProductDto, { ...base, images });
      expect(msgs.length).toBeGreaterThan(0);
    });

    it('rejects individual image URLs > 2048 chars', async () => {
      const tooLongUrl = 'https://x.com/' + 'a'.repeat(2050);
      const msgs = await validateDto(CreateHardwareProductDto, {
        ...base,
        images: [tooLongUrl],
      });
      expect(msgs.length).toBeGreaterThan(0);
    });

    it('accepts root-relative product image paths (regression for the seed pattern)', async () => {
      expect(
        await validateDto(CreateHardwareProductDto, {
          ...base,
          images: ['/products/pos-test-001.webp'],
        }),
      ).toEqual([]);
    });
  });

  describe('ReceiveStockDto', () => {
    it('accepts realistic serial entries', async () => {
      expect(
        await validateDto(ReceiveStockDto, {
          qty: 3,
          serials: ['SN-001A', 'SN-001B', 'SN-001C'],
        }),
      ).toEqual([]);
    });

    it('rejects per-serial length > 128 chars', async () => {
      const msgs = await validateDto(ReceiveStockDto, {
        qty: 1,
        serials: ['a'.repeat(129)],
      });
      expect(msgs.length).toBeGreaterThan(0);
    });

    it('rejects characters outside the safe alphanumeric+punct set', async () => {
      // Slash isn't in [A-Za-z0-9._:-] so the Matches regex rejects.
      // class-validator may surface the error under an array-index key
      // like "serials.0" rather than "serials" — assert on the overall
      // validation outcome.
      const msgs = await validateDto(ReceiveStockDto, {
        qty: 1,
        serials: ['SN/INJECT'],
      });
      expect(msgs.length).toBeGreaterThan(0);
    });
  });
});
