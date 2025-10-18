# KDS Desktop Application Guide

## Overview

The KDS POS system is now available as a native desktop application built with Tauri. The desktop app provides better performance, offline capabilities, and direct hardware integration (thermal printers, cash drawers, etc.).

## Features

### Desktop-Specific Features
- ✅ **Thermal Printer Support** - Direct ESC/POS printer integration
- ✅ **Cash Drawer Control** - Open cash drawer via printer port
- ✅ **System Tray** - Minimize to system tray
- ✅ **Offline Mode** - Continue working without internet
- ✅ **Keyboard Shortcuts** - F11 for fullscreen, Ctrl+P for print
- ✅ **Native Performance** - Faster startup and lower resource usage
- ✅ **Auto-Updates** - Automatic application updates (future)
- ✅ **Multi-Window** - Separate POS and Kitchen display windows

### Advantages Over Web App
- 🚀 **10x smaller** - ~10 MB vs ~100 MB (Electron)
- ⚡ **Faster startup** - <1 second vs 3-5 seconds
- 💾 **Less RAM** - ~80 MB vs ~300 MB
- 🖨️ **Better printer support** - Direct hardware access
- 📴 **True offline mode** - Works without server connection
- 🔒 **More secure** - Rust-based security

---

## Prerequisites

### For Development

1. **Node.js 18+** and npm
   ```bash
   node --version  # Should be 18+
   npm --version
   ```

2. **Rust** (required for Tauri)
   ```bash
   # Install Rust
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

   # Verify installation
   rustc --version
   cargo --version
   ```

3. **System Dependencies**

   **Linux (Ubuntu/Debian):**
   ```bash
   sudo apt update
   sudo apt install -y \
     libwebkit2gtk-4.0-dev \
     build-essential \
     curl \
     wget \
     file \
     libssl-dev \
     libgtk-3-dev \
     libayatana-appindicator3-dev \
     librsvg2-dev \
     libudev-dev
   ```

   **macOS:**
   ```bash
   # Install Xcode Command Line Tools
   xcode-select --install
   ```

   **Windows:**
   - Install [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
   - Install [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (usually pre-installed on Windows 10/11)

---

## Installation

### 1. Install Dependencies

```bash
cd frontend
npm install
```

This will install both web and Tauri dependencies.

### 2. Verify Tauri Setup

```bash
npx tauri info
```

This should show your system configuration and verify all dependencies are installed.

---

## Development

### Running the Desktop App

```bash
cd frontend
npm run tauri:dev
```

This will:
1. Start the Vite development server
2. Launch the Tauri window
3. Enable hot reload for both frontend and Rust code

### Development with Backend

**Terminal 1 - Backend:**
```bash
cd backend
npm run start:dev
```

**Terminal 2 - Frontend (Desktop):**
```bash
cd frontend
npm run tauri:dev
```

### Debug Mode

The Tauri dev mode includes:
- Chrome DevTools (F12)
- Hot reload
- Rust console output
- Error stacktraces

---

## Building for Production

### Build All Platforms

```bash
cd frontend

# Production build
npm run tauri:build
```

This creates platform-specific installers in `src-tauri/target/release/bundle/`:

**Windows:**
- `.msi` - Windows Installer
- `.exe` - Portable executable

**macOS:**
- `.dmg` - Disk image
- `.app` - Application bundle

**Linux:**
- `.deb` - Debian/Ubuntu package
- `.AppImage` - Universal Linux app
- `.rpm` - Fedora/RHEL package (if configured)

### Platform-Specific Builds

```bash
# Windows only
npm run tauri:build:windows

# macOS only
npm run tauri:build:mac

# Linux only
npm run tauri:build:linux
```

### Build Locations

After building, find your installers at:
```
frontend/src-tauri/target/release/bundle/
├── msi/          # Windows installers
├── dmg/          # macOS installers
├── deb/          # Debian packages
└── appimage/     # Linux AppImages
```

---

## App Icon Setup

### Generate Icons from Source

1. **Create a 1024x1024 PNG icon**
   - Save as `app-icon.png` in `frontend/` directory
   - Should be square, high resolution
   - Simple, recognizable design

2. **Generate all required icons:**
   ```bash
   cd frontend
   npx tauri icon app-icon.png
   ```

   This automatically creates:
   - `src-tauri/icons/32x32.png`
   - `src-tauri/icons/128x128.png`
   - `src-tauri/icons/128x128@2x.png`
   - `src-tauri/icons/icon.icns` (macOS)
   - `src-tauri/icons/icon.ico` (Windows)
   - `src-tauri/icons/icon.png` (Linux)

---

## Printer Setup

### Supported Printers

The desktop app supports ESC/POS compatible thermal printers:

- **Epson**: TM-T20, TM-T82, TM-T88 series
- **Star**: TSP100, TSP650, TSP700 series
- **Generic**: Any ESC/POS compatible printer

### Connecting a Printer

1. **Hardware Connection:**
   - USB: Plug printer into USB port
   - Serial (RS-232): Use USB-to-Serial adapter if needed
   - Network: Not yet supported (coming soon)

2. **Install Printer Drivers:**
   - Windows: Install manufacturer drivers
   - macOS: Usually works without drivers
   - Linux: Install cups and printer drivers
     ```bash
     sudo apt install cups
     ```

3. **Configure in App:**
   - Open Settings → Printer Configuration
   - Click "Refresh" to scan for printers
   - Select your printer port (e.g., `/dev/ttyUSB0`, `COM3`)
   - Click "Save Configuration"
   - Click "Test Print" to verify

### Printer Port Examples

- **Windows**: `COM1`, `COM3`, `COM4`, etc.
- **macOS**: `/dev/cu.usbserial`, `/dev/tty.usbserial`
- **Linux**: `/dev/ttyUSB0`, `/dev/ttyS0`, `/dev/usb/lp0`

### Troubleshooting Printers

**Printer not detected:**
```bash
# Linux - Check USB devices
lsusb

# Linux - Check serial ports
ls /dev/tty*

# Windows - Check device manager
devmgmt.msc
```

**Permission denied (Linux):**
```bash
# Add user to dialout group
sudo usermod -a -G dialout $USER

# Restart to apply
sudo reboot
```

**Test manually:**
```bash
# Linux - Test printer directly
echo "Test" > /dev/ttyUSB0
```

---

## Using the Desktop App

### First Launch

1. Launch the application
2. Configure your backend API URL in settings
3. Set up printer (Settings → Printer Configuration)
4. Start using the POS system

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `F11` | Toggle fullscreen |
| `Ctrl+P` | Quick print receipt |
| `Ctrl+Q` | Quit application |
| `Ctrl+W` | Close window |
| `Ctrl+M` | Minimize to tray |

### System Tray

The app minimizes to system tray:
- **Left click** - Show/hide window
- **Right click** - Open menu
  - Show
  - Quit

### Offline Mode

The desktop app continues working without internet:
1. Orders are queued locally
2. Automatic sync when connection restored
3. Visual indicator shows connection status

---

## Distribution

### Windows Distribution

**Option 1: MSI Installer (Recommended)**
- Professional installer experience
- Automatic updates support
- Add to "Add/Remove Programs"

**Option 2: Portable EXE**
- No installation required
- Run from USB drive
- Good for testing

### macOS Distribution

**Requirements:**
- Code signing certificate (for distribution outside Mac App Store)
- Notarization (for macOS 10.15+)

**Build signed app:**
```bash
# Set signing identity in tauri.conf.json
npm run tauri:build:mac
```

### Linux Distribution

**DEB Package (Ubuntu/Debian):**
```bash
sudo dpkg -i kds-pos_1.0.0_amd64.deb
```

**AppImage (Universal):**
```bash
chmod +x kds-pos_1.0.0_amd64.AppImage
./kds-pos_1.0.0_amd64.AppImage
```

---

## Advanced Configuration

### Custom Window Size

Edit `frontend/src-tauri/tauri.conf.json`:
```json
{
  "tauri": {
    "windows": [{
      "width": 1920,
      "height": 1080,
      "fullscreen": true
    }]
  }
}
```

### Multiple Windows

Create separate windows for POS and Kitchen Display:
```json
{
  "tauri": {
    "windows": [
      {
        "label": "pos",
        "title": "POS",
        "width": 1280,
        "height": 800
      },
      {
        "label": "kitchen",
        "title": "Kitchen Display",
        "width": 1920,
        "height": 1080,
        "fullscreen": true
      }
    ]
  }
}
```

### Auto-Start on Boot

**Windows:**
1. Build application
2. Create shortcut in `shell:startup` folder

**macOS:**
1. System Preferences → Users → Login Items
2. Add KDS POS.app

**Linux (systemd):**
```bash
# Create service file
sudo nano /etc/systemd/system/kds-pos.service
```

```ini
[Unit]
Description=KDS POS
After=network.target

[Service]
Type=simple
User=youruser
ExecStart=/path/to/kds-pos
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable kds-pos
sudo systemctl start kds-pos
```

---

## Updating the Desktop App

### Manual Update

1. Download new installer
2. Run installer (will replace old version)
3. Your data and settings are preserved

### Auto-Update (Future)

Auto-update will be enabled in future versions:
- Automatic check for updates
- Download and install in background
- Notify user when update ready

---

## Development Tips

### Hot Reload

Tauri supports hot reload for:
- ✅ React/TypeScript code
- ✅ Rust code (with `cargo watch`)
- ✅ Configuration changes

### Debugging Rust

```bash
# View Rust logs
RUST_LOG=debug npm run tauri:dev
```

### Testing Printer Commands

Create a test script:
```typescript
import { PrinterService } from './lib/tauri';

const testReceipt = {
  order_id: 'TEST-001',
  items: [
    { name: 'Burger', quantity: 2, price: 12.99 },
    { name: 'Fries', quantity: 1, price: 4.99 },
  ],
  total: 30.97,
  payment_method: 'Cash',
  table_number: '5',
};

await PrinterService.printReceipt(testReceipt);
```

---

## Troubleshooting

### Build Errors

**Rust not found:**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

**WebView2 missing (Windows):**
- Download from https://developer.microsoft.com/microsoft-edge/webview2/

**GTK errors (Linux):**
```bash
sudo apt install libwebkit2gtk-4.0-dev
```

### Runtime Issues

**App won't start:**
1. Check antivirus isn't blocking it
2. Run from terminal to see errors
3. Check logs in app data folder

**Printer not working:**
1. Verify driver installation
2. Check USB/Serial connection
3. Try test print from OS
4. Check app has permissions

---

## Performance Tips

1. **Reduce bundle size:**
   - Remove unused dependencies
   - Enable tree-shaking
   - Compress assets

2. **Optimize startup:**
   - Lazy load routes
   - Defer non-critical initialization
   - Cache static assets

3. **Memory management:**
   - Close unused windows
   - Clear old data periodically
   - Limit image sizes

---

## Support

### Logs Location

**Windows:**
```
C:\Users\<User>\AppData\Roaming\com.kds.pos\logs\
```

**macOS:**
```
~/Library/Application Support/com.kds.pos/logs/
```

**Linux:**
```
~/.local/share/com.kds.pos/logs/
```

### Getting Help

1. Check this guide
2. Review error logs
3. Check GitHub issues
4. Contact support

---

## Next Steps

1. ✅ Build your first desktop app
2. ✅ Test with thermal printer
3. ⬜ Deploy to restaurant
4. ⬜ Set up auto-updates
5. ⬜ Create installation guide for staff

---

**Congratulations!** You now have a fully-featured desktop POS application! 🎉
