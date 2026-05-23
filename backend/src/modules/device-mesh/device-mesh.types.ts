// Mesh-side type vocabulary. Kept narrow on purpose — adding a new device
// kind is a string in the DB, not a code change.

export type DeviceKind =
  | 'tablet_waiter'
  | 'tablet_customer'
  | 'kds_screen'
  | 'bar_screen'
  | 'pos_terminal'
  | 'yazarkasa'
  | 'receipt_printer'
  | 'kitchen_printer'
  | 'caller_id'
  | 'scanner'
  | 'local_bridge';

export type DeviceStatus =
  | 'unprovisioned'   // slot created, no device claimed yet
  | 'claimed'          // pair code generated, awaiting device
  | 'paired'           // first successful pair, no heartbeat yet
  | 'online'           // heartbeating within window
  | 'offline'          // heartbeat lapsed
  | 'busy'             // a command is in flight
  | 'error'            // last command failed; awaiting clear
  | 'maintenance'      // admin-toggled silence
  | 'retired';

export type CommandKind =
  | 'print_receipt'
  | 'open_drawer'
  | 'fiscal_receipt'
  | 'fiscal_cancel'
  | 'charge_card'
  | 'show_order'
  | 'clear_order'
  | 'reboot'
  | 'firmware_update'
  | 'capability_probe'
  | 'noop';
