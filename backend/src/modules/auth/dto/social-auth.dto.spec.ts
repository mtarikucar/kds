import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GoogleAuthDto, AppleAuthDto } from './social-auth.dto';
import { VerifyEmailCodeDto } from './verify-email-code.dto';

/**
 * Validation specs for the social-auth + email-verification DTOs:
 *  - GoogleAuthDto.credential and AppleAuthDto.identityToken are required
 *    non-empty strings (the tokens we hand to Google/Apple verification)
 *  - VerifyEmailCodeDto.code is exactly 6 digits (Length + Matches)
 */
async function validateDto(cls: any, input: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, input) as object);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('GoogleAuthDto', () => {
  it('accepts a credential string', async () => {
    expect(await validateDto(GoogleAuthDto, { credential: 'token-abc' })).toEqual([]);
  });

  it('rejects an empty credential (IsNotEmpty)', async () => {
    const msgs = await validateDto(GoogleAuthDto, { credential: '' });
    expect(msgs.some((m) => /credential/i.test(m))).toBe(true);
  });

  it('rejects a missing credential', async () => {
    const msgs = await validateDto(GoogleAuthDto, {});
    expect(msgs.some((m) => /credential/i.test(m))).toBe(true);
  });
});

describe('AppleAuthDto', () => {
  it('accepts an identityToken with optional names', async () => {
    expect(
      await validateDto(AppleAuthDto, {
        identityToken: 'apple-token',
        firstName: 'John',
        lastName: 'Doe',
      }),
    ).toEqual([]);
  });

  it('accepts an identityToken without names (first-sign-in fields optional)', async () => {
    expect(await validateDto(AppleAuthDto, { identityToken: 'apple-token' })).toEqual([]);
  });

  it('rejects an empty identityToken', async () => {
    const msgs = await validateDto(AppleAuthDto, { identityToken: '' });
    expect(msgs.some((m) => /identityToken/i.test(m))).toBe(true);
  });
});

describe('VerifyEmailCodeDto', () => {
  const base = () => ({ email: 'user@example.com', code: '123456' });

  it('accepts a valid 6-digit code', async () => {
    expect(await validateDto(VerifyEmailCodeDto, base())).toEqual([]);
  });

  it('rejects an invalid email', async () => {
    const msgs = await validateDto(VerifyEmailCodeDto, { ...base(), email: 'nope' });
    expect(msgs.some((m) => /email/i.test(m))).toBe(true);
  });

  it('rejects a code that is not 6 chars (Length)', async () => {
    const msgs = await validateDto(VerifyEmailCodeDto, { ...base(), code: '123' });
    expect(msgs.some((m) => /Kod/i.test(m) || /code/i.test(m))).toBe(true);
  });

  it('rejects a 6-char code with non-digits (Matches)', async () => {
    const msgs = await validateDto(VerifyEmailCodeDto, { ...base(), code: '12a456' });
    expect(msgs.some((m) => /rakam/i.test(m) || /code/i.test(m))).toBe(true);
  });
});
