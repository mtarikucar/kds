import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateOnboardingDto, TourProgressDto } from './update-onboarding.dto';

/**
 * Validation specs for UpdateOnboardingDto. All fields optional; boolean
 * flags must be booleans; tourProgress must be an object.
 */
async function validateDto(cls: any, input: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, input) as object);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('UpdateOnboardingDto', () => {
  it('accepts an empty body (all optional)', async () => {
    expect(await validateDto(UpdateOnboardingDto, {})).toEqual([]);
  });

  it('accepts valid flags and a tourProgress object', async () => {
    expect(
      await validateDto(UpdateOnboardingDto, {
        hasSeenWelcome: true,
        skipAllTours: false,
        tourProgress: { menu: { completed: true } },
      }),
    ).toEqual([]);
  });

  it('rejects a non-boolean hasSeenWelcome (IsBoolean)', async () => {
    const msgs = await validateDto(UpdateOnboardingDto, { hasSeenWelcome: 'yes' });
    expect(msgs.some((m) => /hasSeenWelcome/i.test(m))).toBe(true);
  });

  it('rejects a non-object tourProgress (IsObject)', async () => {
    const msgs = await validateDto(UpdateOnboardingDto, { tourProgress: 'nope' });
    expect(msgs.some((m) => /tourProgress/i.test(m))).toBe(true);
  });
});

describe('TourProgressDto', () => {
  it('accepts a completed flag', async () => {
    expect(await validateDto(TourProgressDto, { completed: true, lastStep: 3 })).toEqual([]);
  });

  it('rejects a non-boolean completed', async () => {
    const msgs = await validateDto(TourProgressDto, { completed: 'x' });
    expect(msgs.some((m) => /completed/i.test(m))).toBe(true);
  });
});
