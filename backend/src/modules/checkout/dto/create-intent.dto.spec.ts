import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CheckoutBuyerDto,
  CreateCheckoutIntentDto,
} from './create-intent.dto';

/**
 * Validation specs for the checkout-intent input contract:
 *  - buyer.email is a real email; name non-empty; phone matches the lenient
 *    TR phone regex (blocks HTML/script payloads); address optional <=240
 *  - returnUrl must be an absolute http(s) URL (open-redirect guard) — rejects
 *    javascript:/protocol-relative
 *  - branchId, when present, must be a UUID
 */
function collect(es: any[]): string[] {
  return es.flatMap((e) => [
    ...Object.values(e.constraints ?? {}),
    ...collect(e.children ?? []),
  ]) as string[];
}
async function validateDto(cls: any, input: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(cls, input) as object;
  return collect(await validate(dto));
}

describe('CheckoutBuyerDto', () => {
  const base = () => ({ email: 'a@b.com', name: 'Ahmet', phone: '+90 555 111 22 33' });

  it('accepts a valid buyer', async () => {
    expect(await validateDto(CheckoutBuyerDto, base())).toEqual([]);
  });

  it('rejects a non-email', async () => {
    const msgs = await validateDto(CheckoutBuyerDto, { ...base(), email: 'nope' });
    expect(msgs.some((m) => /email/i.test(m))).toBe(true);
  });

  it('rejects an empty name', async () => {
    const msgs = await validateDto(CheckoutBuyerDto, { ...base(), name: '' });
    expect(msgs.some((m) => /name/i.test(m))).toBe(true);
  });

  it('rejects a phone with script-like content (Matches regex)', async () => {
    const msgs = await validateDto(CheckoutBuyerDto, { ...base(), phone: '<script>x' });
    expect(msgs.some((m) => /phone/i.test(m))).toBe(true);
  });

  it('rejects an address over 240 chars', async () => {
    const msgs = await validateDto(CheckoutBuyerDto, { ...base(), address: 'x'.repeat(241) });
    expect(msgs.some((m) => /address/i.test(m))).toBe(true);
  });
});

describe('CreateCheckoutIntentDto', () => {
  const validCart = { items: [{ kind: 'plan', planId: 'p', billingCycle: 'MONTHLY' }] };
  const validBuyer = { email: 'a@b.com', name: 'Ahmet', phone: '+90 555 111 22 33' };

  function base(): Record<string, unknown> {
    return { cart: validCart, buyer: validBuyer };
  }

  it('accepts a valid http(s) returnUrl', async () => {
    const msgs = await validateDto(CreateCheckoutIntentDto, {
      ...base(),
      returnUrl: 'https://app.example.com/done',
    });
    expect(msgs.some((m) => /returnUrl/i.test(m))).toBe(false);
  });

  it('rejects a javascript: returnUrl (open-redirect guard)', async () => {
    const msgs = await validateDto(CreateCheckoutIntentDto, {
      ...base(),
      returnUrl: 'javascript:alert(1)',
    });
    expect(msgs.some((m) => /returnUrl/i.test(m))).toBe(true);
  });

  it('rejects a protocol-relative returnUrl', async () => {
    const msgs = await validateDto(CreateCheckoutIntentDto, {
      ...base(),
      returnUrl: '//evil.example.com',
    });
    expect(msgs.some((m) => /returnUrl/i.test(m))).toBe(true);
  });

  it('rejects a non-uuid branchId', async () => {
    const msgs = await validateDto(CreateCheckoutIntentDto, {
      ...base(),
      branchId: 'not-a-uuid',
    });
    expect(msgs.some((m) => /branchId/i.test(m))).toBe(true);
  });

  it('propagates a nested invalid buyer (ValidateNested)', async () => {
    const msgs = await validateDto(CreateCheckoutIntentDto, {
      cart: validCart,
      buyer: { email: 'bad', name: '', phone: 'x' },
    });
    expect(msgs.length).toBeGreaterThan(0);
  });
});
