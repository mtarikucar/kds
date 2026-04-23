import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import {
  EmptyStringToNumber,
  EmptyStringToUndefined,
  StringToBoolean,
} from './transforms';

class NumberDto {
  @EmptyStringToNumber()
  amount?: number;
}

class StringDto {
  @EmptyStringToUndefined()
  note?: string;
}

class BooleanDto {
  @StringToBoolean()
  flag?: boolean;
}

describe('transforms', () => {
  describe('EmptyStringToUndefined', () => {
    it('collapses empty and whitespace strings to undefined', () => {
      expect(plainToInstance(StringDto, { note: '' }).note).toBeUndefined();
      expect(plainToInstance(StringDto, { note: '   ' }).note).toBeUndefined();
    });

    it('passes real strings through untouched', () => {
      expect(plainToInstance(StringDto, { note: 'hello' }).note).toBe('hello');
    });

    it('leaves undefined/null alone for @IsOptional to handle', () => {
      expect(plainToInstance(StringDto, {}).note).toBeUndefined();
      expect(plainToInstance(StringDto, { note: null as any }).note).toBeNull();
    });
  });

  describe('EmptyStringToNumber', () => {
    it('returns undefined for empty/whitespace strings', () => {
      expect(plainToInstance(NumberDto, { amount: '' }).amount).toBeUndefined();
      expect(plainToInstance(NumberDto, { amount: '   ' }).amount).toBeUndefined();
    });

    it('parses numeric strings', () => {
      expect(plainToInstance(NumberDto, { amount: '42' }).amount).toBe(42);
      expect(plainToInstance(NumberDto, { amount: '3.14' }).amount).toBeCloseTo(3.14);
    });

    it('passes through real numbers', () => {
      expect(plainToInstance(NumberDto, { amount: 7 }).amount).toBe(7);
    });

    it('returns undefined for garbage strings instead of NaN', () => {
      expect(plainToInstance(NumberDto, { amount: 'abc' }).amount).toBeUndefined();
    });

    it('returns undefined for NaN number values', () => {
      expect(plainToInstance(NumberDto, { amount: Number.NaN }).amount).toBeUndefined();
    });
  });

  describe('StringToBoolean', () => {
    it('casts "true"/"false" strings', () => {
      expect(plainToInstance(BooleanDto, { flag: 'true' }).flag).toBe(true);
      expect(plainToInstance(BooleanDto, { flag: 'false' }).flag).toBe(false);
    });

    it('casts "1"/"0" strings', () => {
      expect(plainToInstance(BooleanDto, { flag: '1' }).flag).toBe(true);
      expect(plainToInstance(BooleanDto, { flag: '0' }).flag).toBe(false);
    });

    it('casts numeric 1/0', () => {
      expect(plainToInstance(BooleanDto, { flag: 1 }).flag).toBe(true);
      expect(plainToInstance(BooleanDto, { flag: 0 }).flag).toBe(false);
    });

    it('is case-insensitive and trims whitespace', () => {
      expect(plainToInstance(BooleanDto, { flag: '  TRUE  ' }).flag).toBe(true);
    });

    it('returns undefined for empty/unknown strings', () => {
      expect(plainToInstance(BooleanDto, { flag: '' }).flag).toBeUndefined();
      expect(plainToInstance(BooleanDto, { flag: 'maybe' as any }).flag).toBe('maybe');
    });

    it('passes real booleans through', () => {
      expect(plainToInstance(BooleanDto, { flag: true }).flag).toBe(true);
      expect(plainToInstance(BooleanDto, { flag: false }).flag).toBe(false);
    });
  });
});
