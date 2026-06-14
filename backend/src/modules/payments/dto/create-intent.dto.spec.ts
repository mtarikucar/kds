import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateIntentDto } from './create-intent.dto';

/**
 * Validation spec for the subscription checkout CreateIntentDto:
 *  - billingCycle restricted to MONTHLY|YEARLY (IsIn)
 *  - acceptedDocumentIds must be EXACTLY 3 uuids (legal consent rows)
 *  - referralCode optional, alphanumeric-ish, <=40 chars; never blocks checkout
 */
describe('CreateIntentDto (payments)', () => {
  async function validateDto(input: Record<string, unknown>): Promise<string[]> {
    const dto = plainToInstance(CreateIntentDto, input) as object;
    const errors = await validate(dto);
    return errors.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  const uuids = [
    '6b0b887d-c741-4f8f-9f3f-08501f075aef',
    'e5cd8e6c-1bbb-4fab-a6bf-5ef35b0d429b',
    '86b9743c-c8f5-4192-88d6-b278a18d1978',
  ];

  function base(): Record<string, unknown> {
    return {
      planId: 'plan_pro',
      billingCycle: 'MONTHLY',
      acceptedDocumentIds: uuids,
    };
  }

  it('accepts a valid intent', async () => {
    expect(await validateDto(base())).toEqual([]);
  });

  it('rejects an invalid billingCycle', async () => {
    const msgs = await validateDto({ ...base(), billingCycle: 'WEEKLY' });
    expect(msgs.some((m) => /billingCycle/i.test(m))).toBe(true);
  });

  it('rejects fewer than 3 accepted documents (ArrayMinSize)', async () => {
    const msgs = await validateDto({ ...base(), acceptedDocumentIds: uuids.slice(0, 2) });
    expect(msgs.some((m) => /acceptedDocumentIds/i.test(m))).toBe(true);
  });

  it('rejects more than 3 accepted documents (ArrayMaxSize)', async () => {
    const msgs = await validateDto({
      ...base(),
      acceptedDocumentIds: [...uuids, 'a6715a3c-92b1-41e5-a54f-c4bb6591daff'],
    });
    expect(msgs.some((m) => /acceptedDocumentIds/i.test(m))).toBe(true);
  });

  it('rejects non-uuid document ids (IsUUID each)', async () => {
    const msgs = await validateDto({ ...base(), acceptedDocumentIds: ['a', 'b', 'c'] });
    expect(msgs.some((m) => /acceptedDocumentIds/i.test(m))).toBe(true);
  });

  it('accepts a valid referral code', async () => {
    expect(await validateDto({ ...base(), referralCode: 'AHMET_42-x' })).toEqual([]);
  });

  it('rejects a referral code with illegal chars (Matches regex)', async () => {
    const msgs = await validateDto({ ...base(), referralCode: 'bad code!' });
    expect(msgs.some((m) => /referralCode/i.test(m))).toBe(true);
  });

  it('rejects a referral code over 40 chars (MaxLength)', async () => {
    const msgs = await validateDto({ ...base(), referralCode: 'a'.repeat(41) });
    expect(msgs.some((m) => /referralCode/i.test(m))).toBe(true);
  });

  it('allows referralCode to be omitted (optional)', async () => {
    expect(await validateDto(base())).toEqual([]);
  });
});
