import { describe, it, expect } from 'vitest';
import { appendKey } from './numericKeypadLogic';

describe('numericKeypadLogic.appendKey', () => {
  it('appends a digit to an empty value', () => {
    expect(appendKey('', '5')).toBe('5');
  });

  it('appends digits in sequence', () => {
    expect(appendKey('12', '3')).toBe('123');
  });

  it('replaces a lone leading zero instead of stacking it', () => {
    expect(appendKey('0', '7')).toBe('7');
  });

  it('turns a leading decimal into 0.', () => {
    expect(appendKey('', '.')).toBe('0.');
  });

  it('adds a single decimal separator', () => {
    expect(appendKey('12', '.')).toBe('12.');
  });

  it('ignores a second decimal separator', () => {
    expect(appendKey('12.5', '.')).toBe('12.5');
  });

  it('allows exactly two fractional digits', () => {
    expect(appendKey('12.3', '4')).toBe('12.34');
  });

  it('ignores a third fractional digit', () => {
    expect(appendKey('12.34', '5')).toBe('12.34');
  });

  it('backspaces the last character', () => {
    expect(appendKey('123', 'back')).toBe('12');
  });

  it('backspaces to empty', () => {
    expect(appendKey('1', 'back')).toBe('');
    expect(appendKey('', 'back')).toBe('');
  });
});
