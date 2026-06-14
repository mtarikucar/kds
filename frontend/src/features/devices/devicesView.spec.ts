import { describe, it, expect } from 'vitest';
import { statusPillColor, visibleDevices } from './devicesView';
import type { Device } from './devicesApi';

/**
 * Unit spec for the extracted DevicesPage view helpers (were
 * module-private): the status-pill colour map (with fallback) and the
 * retired-row visibility filter.
 */
function makeDevice(id: string, status: string): Device {
  return { id, status } as unknown as Device;
}

describe('statusPillColor', () => {
  it('maps each known mesh status to its colour classes', () => {
    expect(statusPillColor('online')).toBe('bg-green-100 text-green-800');
    expect(statusPillColor('offline')).toBe('bg-gray-100 text-gray-700');
    expect(statusPillColor('error')).toBe('bg-red-100 text-red-800');
    expect(statusPillColor('busy')).toBe('bg-amber-100 text-amber-800');
    expect(statusPillColor('maintenance')).toBe('bg-blue-100 text-blue-800');
    expect(statusPillColor('paired')).toBe('bg-emerald-50 text-emerald-700');
    expect(statusPillColor('unprovisioned')).toBe('bg-yellow-100 text-yellow-800');
    expect(statusPillColor('claimed')).toBe('bg-purple-100 text-purple-800');
    expect(statusPillColor('retired')).toBe('bg-gray-100 text-gray-500');
  });

  it('falls back to neutral gray for an unknown status', () => {
    expect(statusPillColor('something-else')).toBe('bg-gray-100 text-gray-700');
    expect(statusPillColor('')).toBe('bg-gray-100 text-gray-700');
  });
});

describe('visibleDevices', () => {
  const devices = [
    makeDevice('a', 'online'),
    makeDevice('b', 'retired'),
    makeDevice('c', 'offline'),
    makeDevice('d', 'retired'),
  ];

  it('hides retired devices by default', () => {
    const visible = visibleDevices(devices, false);
    expect(visible.map((d) => d.id)).toEqual(['a', 'c']);
  });

  it('includes retired devices when the toggle is on', () => {
    const visible = visibleDevices(devices, true);
    expect(visible.map((d) => d.id)).toEqual(['a', 'b', 'c', 'd']);
    // includeRetired=true returns the original array reference (no filter)
    expect(visible).toBe(devices);
  });
});
