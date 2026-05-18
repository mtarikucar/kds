import { validate } from 'class-validator';
import { AtLeastOneOf } from './at-least-one-of.decorator';

@AtLeastOneOf(['email', 'phone'])
class TestDto {
  email?: string;
  phone?: string;
}

describe('AtLeastOneOf', () => {
  it('passes when only one of the keys is supplied', async () => {
    const a = Object.assign(new TestDto(), { email: 'a@b.com' });
    expect(await validate(a)).toEqual([]);

    const b = Object.assign(new TestDto(), { phone: '+905551234567' });
    expect(await validate(b)).toEqual([]);
  });

  it('passes when both keys are supplied', async () => {
    const obj = Object.assign(new TestDto(), { email: 'a@b.com', phone: '+1' });
    expect(await validate(obj)).toEqual([]);
  });

  it('fails when all keys are missing', async () => {
    const errors = await validate(new TestDto());
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints?.AtLeastOneOf).toBeDefined();
  });

  it('fails when all keys are empty strings', async () => {
    const obj = Object.assign(new TestDto(), { email: '', phone: '' });
    const errors = await validate(obj);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails when all keys are whitespace-only strings', async () => {
    const obj = Object.assign(new TestDto(), { email: '   ', phone: '\t  ' });
    const errors = await validate(obj);
    expect(errors.length).toBeGreaterThan(0);
  });
});
