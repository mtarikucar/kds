import { describe, it, expect } from 'vitest';
import { reorder } from './reorder';

describe('reorder', () => {
  it('moves an item from an earlier index to a later index', () => {
    expect(reorder(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves an item from a later index to an earlier index', () => {
    expect(reorder(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('is a no-op when start and end indices are equal', () => {
    expect(reorder(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const input = ['a', 'b', 'c'];
    const out = reorder(input, 0, 2);
    expect(input).toEqual(['a', 'b', 'c']);
    expect(out).not.toBe(input);
  });

  it('preserves length and works with object items', () => {
    const items = [{ id: '1' }, { id: '2' }, { id: '3' }];
    const out = reorder(items, 2, 0);
    expect(out.map((i) => i.id)).toEqual(['3', '1', '2']);
    expect(out).toHaveLength(3);
  });
});
