import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { WriteOffOrderDto } from './write-off.dto';

/**
 * Validation spec for WriteOffOrderDto (manager absorbs remaining balance).
 * reason is optional but, when present, must be a 1..240 char string;
 * the @EmptyStringToUndefined transform turns "" into undefined so an empty
 * field doesn't trip @Length.
 */
describe('WriteOffOrderDto', () => {
  async function validateDto(input: Record<string, unknown>): Promise<string[]> {
    const dto = plainToInstance(WriteOffOrderDto, input) as object;
    const errors = await validate(dto);
    return errors.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  it('accepts a missing reason (optional)', async () => {
    expect(await validateDto({})).toEqual([]);
  });

  it('accepts a normal reason string', async () => {
    expect(await validateDto({ reason: 'no-show comp' })).toEqual([]);
  });

  it('treats empty string as undefined (EmptyStringToUndefined), so no Length error', async () => {
    const dto = plainToInstance(WriteOffOrderDto, { reason: '' });
    expect(dto.reason).toBeUndefined();
    const errors = await validate(dto as object);
    expect(errors).toEqual([]);
  });

  it('rejects a reason longer than 240 chars', async () => {
    const msgs = await validateDto({ reason: 'x'.repeat(241) });
    expect(msgs.some((m) => /reason/i.test(m))).toBe(true);
  });

  it('rejects a non-string reason', async () => {
    const msgs = await validateDto({ reason: 123 });
    expect(msgs.some((m) => /reason/i.test(m))).toBe(true);
  });
});
