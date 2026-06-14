import type { Device } from './devicesApi';

/**
 * Pure view helpers extracted verbatim from DevicesPage so the status
 * pill colour mapping and the retired-row visibility filter are
 * unit-testable in isolation.
 *
 * Status pill colours map onto the mesh state machine:
 *   online      green
 *   offline     gray
 *   error       red
 *   busy        amber
 *   maintenance blue
 *   retired     hidden by default
 */

const STATUS_PILL_COLORS: Record<string, string> = {
  online: 'bg-green-100 text-green-800',
  offline: 'bg-gray-100 text-gray-700',
  error: 'bg-red-100 text-red-800',
  busy: 'bg-amber-100 text-amber-800',
  maintenance: 'bg-blue-100 text-blue-800',
  paired: 'bg-emerald-50 text-emerald-700',
  unprovisioned: 'bg-yellow-100 text-yellow-800',
  claimed: 'bg-purple-100 text-purple-800',
  retired: 'bg-gray-100 text-gray-500',
};

/** Resolve the Tailwind colour classes for a device status pill. */
export function statusPillColor(status: string): string {
  return STATUS_PILL_COLORS[status] ?? 'bg-gray-100 text-gray-700';
}

/**
 * Rows shown in the devices table: retired devices are hidden unless the
 * "show retired" toggle is on.
 */
export function visibleDevices(devices: Device[], includeRetired: boolean): Device[] {
  return includeRetired ? devices : devices.filter((d) => d.status !== 'retired');
}
