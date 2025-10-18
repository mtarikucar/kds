# Desktop App Quick Start

## Prerequisites

### 1. Install Rust
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

### 2. Install System Dependencies

**Linux (Ubuntu/Debian):**
```bash
sudo apt update && sudo apt install -y \
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
xcode-select --install
```

**Windows:**
- Install [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- Install [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/)

## Development

### 1. Install Dependencies
```bash
cd frontend
npm install
```

### 2. Run Development Mode
```bash
# Start backend (Terminal 1)
cd backend
npm run start:dev

# Start desktop app (Terminal 2)
cd frontend
npm run tauri:dev
```

The desktop window will launch with hot reload enabled!

## Building

### Build for Your Platform
```bash
cd frontend
npm run tauri:build
```

Installers will be in: `frontend/src-tauri/target/release/bundle/`

### Platform-Specific Builds
```bash
npm run tauri:build:windows  # Windows .msi and .exe
npm run tauri:build:mac      # macOS .dmg and .app
npm run tauri:build:linux    # Linux .deb and .AppImage
```

## Features to Try

### 1. Printer Setup
1. Connect thermal printer (USB or Serial)
2. Open Settings → Printer Configuration
3. Click "Refresh" to detect printers
4. Select your printer and click "Save"
5. Click "Test Print" to verify

### 2. Keyboard Shortcuts
- `F11` - Toggle fullscreen
- `Ctrl+P` - Quick print
- `Ctrl+Q` - Quit app

### 3. System Tray
- App minimizes to system tray
- Left-click to show/hide
- Right-click for menu

## Icon Setup

### Generate App Icons
```bash
# 1. Create 1024x1024 PNG icon
#    Save as: frontend/app-icon.png

# 2. Generate all icons
cd frontend
npx @tauri-apps/cli icon app-icon.png

# 3. Rebuild app
npm run tauri:build
```

## Troubleshooting

### Build Errors

**"Rust not found":**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

**"WebView2 not installed" (Windows):**
Download from: https://developer.microsoft.com/microsoft-edge/webview2/

**"GTK error" (Linux):**
```bash
sudo apt install libwebkit2gtk-4.0-dev
```

### Printer Issues

**Printer not detected:**
```bash
# Linux - Check ports
ls /dev/tty*

# Add user to dialout group
sudo usermod -a -G dialout $USER
sudo reboot
```

**Permission denied:**
Run app with sudo or add user to correct group.

## Next Steps

1. ✅ Run `npm run tauri:dev` to test
2. ✅ Configure printer settings
3. ✅ Build production version
4. ✅ Test on restaurant hardware
5. ✅ Distribute to staff

For complete documentation, see `DESKTOP_APP_GUIDE.md`

---

**Happy building!** 🚀
