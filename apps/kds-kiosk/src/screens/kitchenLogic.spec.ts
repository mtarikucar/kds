import { describe, it, expect } from 'vitest';
import { ageOf, applyCommand, type OrderTicket } from './kitchenLogic';
import type { DeviceCommand } from '../api/mesh';

function cmd(partial: Partial<DeviceCommand>): DeviceCommand {
  return {
    id: 'cmd-1',
    kind: 'show_order',
    payload: {},
    priority: 0,
    attempts: 0,
    idempotencyKey: 'idem-1',
    ...partial,
  };
}

describe('ageOf', () => {
  it('renders seconds for ages under one minute', () => {
    expect(ageOf(1_000, 1_000)).toBe('0s');
    expect(ageOf(1_000, 6_000)).toBe('5s');
    expect(ageOf(0, 59_000)).toBe('59s');
  });

  it('renders minutes between 1 minute and 1 hour, flooring', () => {
    expect(ageOf(0, 60_000)).toBe('1m');
    expect(ageOf(0, 119_000)).toBe('1m'); // 119s -> floor(119/60)=1
    expect(ageOf(0, 120_000)).toBe('2m');
    expect(ageOf(0, 3_599_000)).toBe('59m');
  });

  it('renders hours at and beyond 1 hour, flooring', () => {
    expect(ageOf(0, 3_600_000)).toBe('1h');
    expect(ageOf(0, 7_199_000)).toBe('1h');
    expect(ageOf(0, 7_200_000)).toBe('2h');
  });

  it('floors fractional seconds toward zero', () => {
    expect(ageOf(0, 999)).toBe('0s'); // floor(999/1000)=0
    expect(ageOf(0, 1_999)).toBe('1s');
  });
});

describe('applyCommand', () => {
  it('appends a ticket for a fresh show_order, stamping shownAt with now', () => {
    const next = applyCommand([], cmd({ kind: 'show_order', payload: { orderId: 'o1', table: 5 } }), 12_345);
    expect(next).toEqual([
      { orderId: 'o1', shownAt: 12_345, meta: { orderId: 'o1', table: 5 } },
    ]);
  });

  it('de-dupes show_order for an orderId already present (returns same reference)', () => {
    const prev: OrderTicket[] = [{ orderId: 'o1', shownAt: 100, meta: { orderId: 'o1' } }];
    const next = applyCommand(prev, cmd({ kind: 'show_order', payload: { orderId: 'o1' } }), 999);
    expect(next).toBe(prev); // unchanged reference -> React bails out
  });

  it('removes the matching ticket for clear_order', () => {
    const prev: OrderTicket[] = [
      { orderId: 'o1', shownAt: 100 },
      { orderId: 'o2', shownAt: 200 },
    ];
    const next = applyCommand(prev, cmd({ kind: 'clear_order', payload: { orderId: 'o1' } }), 0);
    expect(next).toEqual([{ orderId: 'o2', shownAt: 200 }]);
  });

  it('leaves the list unchanged for an unknown command kind', () => {
    const prev: OrderTicket[] = [{ orderId: 'o1', shownAt: 100 }];
    const next = applyCommand(prev, cmd({ kind: 'reboot', payload: { orderId: 'o1' } }), 0);
    expect(next).toBe(prev);
  });

  it('leaves the list unchanged when orderId is missing', () => {
    const prev: OrderTicket[] = [{ orderId: 'o1', shownAt: 100 }];
    const next = applyCommand(prev, cmd({ kind: 'show_order', payload: {} }), 0);
    expect(next).toBe(prev);
  });

  it('does not mutate the input array when appending', () => {
    const prev: OrderTicket[] = [{ orderId: 'o1', shownAt: 100 }];
    applyCommand(prev, cmd({ kind: 'show_order', payload: { orderId: 'o2' } }), 5);
    expect(prev).toEqual([{ orderId: 'o1', shownAt: 100 }]); // original untouched
  });
});
