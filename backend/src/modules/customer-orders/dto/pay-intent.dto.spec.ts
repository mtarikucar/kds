import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePayIntentDto, CustomerPayItemEntry } from './pay-intent.dto';

/**
 * Validation specs for self-pay intent:
 *  - items: 1..200, each {orderItemId: uuid, quantity int >=1}; no price field
 *    by design (server owns pricing)
 *  - customerPhone optional, "" → undefined, E.164-ish regex otherwise
 */
function collect(es: any[]): string[] {
  return es.flatMap((e) => [
    ...Object.values(e.constraints ?? {}),
    ...collect(e.children ?? []),
  ]) as string[];
}
async function validateDto(cls: any, input: Record<string, unknown>): Promise<string[]> {
  return collect(await validate(plainToInstance(cls, input) as object));
}

const ITEM = { orderItemId: '6b0b887d-c741-4f8f-9f3f-08501f075aef', quantity: 2 };

describe('CustomerPayItemEntry', () => {
  it('accepts a valid entry', async () => {
    expect(await validateDto(CustomerPayItemEntry, ITEM)).toEqual([]);
  });

  it('rejects a non-uuid orderItemId', async () => {
    const msgs = await validateDto(CustomerPayItemEntry, { ...ITEM, orderItemId: 'x' });
    expect(msgs.some((m) => /orderItemId/i.test(m))).toBe(true);
  });

  it('rejects quantity below 1', async () => {
    const msgs = await validateDto(CustomerPayItemEntry, { ...ITEM, quantity: 0 });
    expect(msgs.some((m) => /quantity/i.test(m))).toBe(true);
  });
});

describe('CreatePayIntentDto', () => {
  it('accepts a minimal valid intent', async () => {
    expect(await validateDto(CreatePayIntentDto, { items: [ITEM] })).toEqual([]);
  });

  it('rejects an empty items array (ArrayMinSize 1)', async () => {
    const msgs = await validateDto(CreatePayIntentDto, { items: [] });
    expect(msgs.some((m) => /items/i.test(m))).toBe(true);
  });

  it('rejects more than 200 items (ArrayMaxSize)', async () => {
    const items = Array.from({ length: 201 }, () => ITEM);
    const msgs = await validateDto(CreatePayIntentDto, { items });
    expect(msgs.some((m) => /items/i.test(m))).toBe(true);
  });

  it('treats empty customerPhone as undefined (EmptyStringToUndefined)', async () => {
    const dto = plainToInstance(CreatePayIntentDto, { items: [ITEM], customerPhone: '' });
    expect(dto.customerPhone).toBeUndefined();
    expect(collect(await validate(dto as object))).toEqual([]);
  });

  it('accepts a valid E.164 phone', async () => {
    expect(
      await validateDto(CreatePayIntentDto, { items: [ITEM], customerPhone: '+905551112233' }),
    ).toEqual([]);
  });

  it('rejects a malformed phone (Matches regex)', async () => {
    const msgs = await validateDto(CreatePayIntentDto, { items: [ITEM], customerPhone: 'abc' });
    expect(msgs.some((m) => /customerPhone/i.test(m))).toBe(true);
  });
});
