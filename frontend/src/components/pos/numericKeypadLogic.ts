/**
 * Pure key-append logic for the cash NumericKeypad, extracted so the component
 * file only exports a component (keeps react-refresh happy) and the transform
 * stays unit-testable in isolation.
 *
 * Rules:
 *  - Single decimal separator only (a second '.' is ignored).
 *  - At most 2 fractional digits.
 *  - A leading bare '.' becomes '0.'.
 *  - 'back' removes the last char; clearing to empty yields ''.
 *  - A lone leading '0' is replaced by the next digit (no "0005" pileup).
 */
export const appendKey = (value: string, key: string): string => {
  if (key === 'back') return value.slice(0, -1);
  if (key === '.') {
    if (value.includes('.')) return value;
    return value === '' ? '0.' : value + '.';
  }
  // numeric digit
  const dotIndex = value.indexOf('.');
  if (dotIndex >= 0 && value.length - dotIndex - 1 >= 2) {
    // already 2 fractional digits — ignore further input
    return value;
  }
  if (value === '0') return key;
  return value + key;
};
