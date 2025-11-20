# HummyTummy Desktop POS Application

Desktop application for HummyTummy Restaurant POS with Bluetooth printer support.

## Features

- ✅ **Bluetooth Device Scanning** - Discover nearby Bluetooth printers and devices
- ✅ **BLE Connection Management** - Connect/disconnect from Bluetooth Low Energy devices
- ✅ **Bluetooth Read/Write** - Read from and write to device characteristics
- ✅ **ESC/POS Printer Support** - Full support for thermal receipt printers
- ✅ **Receipt Printing** - Print formatted receipts with items, totals, and QR codes
- ✅ **Cross-platform** - Works on Windows, macOS, and Linux

## Prerequisites

### Development Requirements

- **Rust** (1.70 or later)
- **Node.js** (18 or later)
- **Tauri CLI** (installed automatically with npm)

### Platform-Specific Requirements

#### Windows
- No additional requirements

#### macOS
- Xcode Command Line Tools

#### Linux
```bash
# Debian/Ubuntu
sudo apt install libdbus-1-dev pkg-config

# Fedora
sudo dnf install dbus-devel

# Arch Linux
sudo pacman -S dbus
```

## Installation

1. **Install dependencies:**
```bash
npm install
```

2. **Build the application:**
```bash
npm run tauri:build
```

## Development

Run the app in development mode:
```bash
npm run tauri:dev
```

## Usage

### Bluetooth API

The desktop app exposes the following Tauri commands:

#### Initialize Bluetooth
```javascript
import { invoke } from '@tauri-apps/api/tauri';

await invoke('init_bluetooth');
```

#### Scan for Devices
```javascript
// Scan for 10 seconds
const devices = await invoke('scan_devices', { duration: 10 });
console.log(devices);
// [
//   { id: "XX:XX:XX:XX:XX:XX", name: "Bluetooth Printer", rssi: -45, is_connected: false }
// ]
```

#### Connect to Device
```javascript
await invoke('connect_device', { deviceId: "XX:XX:XX:XX:XX:XX" });
```

#### Print Receipt
```javascript
const receiptData = {
  restaurant_name: "HummyTummy Restaurant",
  restaurant_address: "123 Main St, City, Country",
  items: [
    { name: "Burger", quantity: 2, price: 15.99 },
    { name: "Fries", quantity: 1, price: 4.99 }
  ],
  subtotal: 36.97,
  tax: 3.70,
  total: 40.67,
  payment_method: "Cash",
  order_number: "12345",
  qr_code_data: "https://menu.hummytummy.com/order/12345"
};

await invoke('print_receipt', {
  deviceId: "XX:XX:XX:XX:XX:XX",
  receiptData
});
```

#### Get Connected Devices
```javascript
const connected = await invoke('get_connected_devices');
```

#### Disconnect Device
```javascript
await invoke('disconnect_device', { deviceId: "XX:XX:XX:XX:XX:XX" });
```

### Low-Level Bluetooth Operations

#### Write to Characteristic
```javascript
const data = [0x1B, 0x40]; // ESC @ (Initialize printer)
await invoke('write_characteristic', {
  deviceId: "XX:XX:XX:XX:XX:XX",
  characteristicUuid: "0000ff01-0000-1000-8000-00805f9b34fb",
  data
});
```

#### Read from Characteristic
```javascript
const data = await invoke('read_characteristic', {
  deviceId: "XX:XX:XX:XX:XX:XX",
  characteristicUuid: "0000ff02-0000-1000-8000-00805f9b34fb"
});
```

## Supported Printers

The application uses ESC/POS commands and should work with most thermal receipt printers that support:

- Bluetooth Low Energy (BLE)
- ESC/POS command set

### Tested Printers
- Generic Bluetooth thermal printers (58mm, 80mm)
- Star Micronics SM-S230i
- Epson TM-P20
- Zebra iMZ220

### Common Printer UUIDs

Most Bluetooth printers use these characteristic UUIDs:
- **Write:** `0000ff01-0000-1000-8000-00805f9b34fb`
- **Read:** `0000ff02-0000-1000-8000-00805f9b34fb`
- **Notify:** `0000ff03-0000-1000-8000-00805f9b34fb`

Some printers may use different UUIDs - check your printer's documentation.

## ESC/POS Commands

The Bluetooth module supports these printer commands:

| Command | Description | Example |
|---------|-------------|---------|
| `Initialize` | Reset printer to default state | `PrinterCommand::Initialize` |
| `Text(String)` | Print text without newline | `PrinterCommand::Text("Hello")` |
| `TextLine(String)` | Print text with newline | `PrinterCommand::TextLine("Hello")` |
| `Feed(u8)` | Feed paper n lines | `PrinterCommand::Feed(3)` |
| `Cut` | Cut paper | `PrinterCommand::Cut` |
| `Align(u8)` | Set alignment (0=left, 1=center, 2=right) | `PrinterCommand::Align(1)` |
| `TextSize(u8, u8)` | Set text size (width, height: 1-8) | `PrinterCommand::TextSize(2, 2)` |
| `Bold(bool)` | Enable/disable bold text | `PrinterCommand::Bold(true)` |
| `Barcode(String)` | Print CODE39 barcode | `PrinterCommand::Barcode("12345")` |
| `QRCode(String)` | Print QR code | `PrinterCommand::QRCode("https://...")` |

## Troubleshooting

### Bluetooth Not Working on Linux

Make sure the `bluetooth` service is running:
```bash
sudo systemctl status bluetooth
sudo systemctl start bluetooth
```

### Permission Issues on Linux

Add your user to the `bluetooth` group:
```bash
sudo usermod -a -G bluetooth $USER
# Log out and log back in
```

### Cannot Find Printer

1. Make sure the printer is turned on and in pairing mode
2. Scan for longer duration: `scan_devices(30)`
3. Check if the printer appears in system Bluetooth settings
4. Try resetting the printer

### Connection Timeout

1. Move printer closer to the computer
2. Remove other Bluetooth devices to reduce interference
3. Restart both printer and application

### Printing Not Working

1. Verify you're connected: `get_connected_devices()`
2. Check the characteristic UUID matches your printer
3. Try sending a simple initialize command first
4. Some printers require discovering services after connection (automatically done)

## Architecture

### Rust Backend (`src-tauri/`)

- **bluetooth.rs** - Bluetooth Low Energy implementation using `btleplug`
- **main.rs** - Tauri application entry point with command handlers

### Frontend Integration

The desktop app can embed the web frontend from `../frontend` or be used as a standalone Tauri app.

## Building for Production

### Windows
```bash
npm run tauri:build
# Output: src-tauri/target/release/bundle/msi/
```

### macOS
```bash
npm run tauri:build
# Output: src-tauri/target/release/bundle/dmg/
```

### Linux
```bash
npm run tauri:build
# Output: src-tauri/target/release/bundle/deb/ or /appimage/
```

## License

Same as main HummyTummy project

## Support

For issues or questions:
- GitHub Issues: https://github.com/yourusername/hummytummy/issues
- Email: contact@hummytummy.com
