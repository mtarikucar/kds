# App Icons

## Generating Icons

To generate all required icons from a single source image:

1. **Create a 1024x1024 PNG icon**
   - Place it in the `frontend/` directory as `app-icon.png`
   - Requirements:
     - Square dimensions (1024x1024px recommended)
     - PNG format with transparency
     - Simple, recognizable design
     - Clear at small sizes

2. **Generate all platform icons:**
   ```bash
   cd frontend
   npx @tauri-apps/cli icon app-icon.png
   ```

This will automatically create all required icon files:
- `32x32.png` - Windows taskbar
- `128x128.png` - App list
- `128x128@2x.png` - Retina displays
- `icon.icns` - macOS bundle
- `icon.ico` - Windows executable
- `icon.png` - Linux desktop

## Manual Icon Creation

If you prefer to create icons manually, you need:

### Windows (.ico)
- Sizes: 16x16, 32x32, 48x48, 256x256
- Format: ICO file with multiple sizes

### macOS (.icns)
- Sizes: 16x16, 32x32, 128x128, 256x256, 512x512, 1024x1024
- Format: ICNS file
- Include @2x versions for Retina

### Linux (.png)
- Size: 512x512 or 1024x1024
- Format: PNG with transparency

## Icon Design Tips

- **Keep it simple** - Should be recognizable at 16x16px
- **Use bold shapes** - Avoid thin lines
- **High contrast** - Stand out on any background
- **Brand consistency** - Match your restaurant/brand colors
- **Test at all sizes** - View at 16px, 32px, 128px, and 512px

## Current Icons

Currently using placeholder icons. Replace with your actual app icon before distribution.

To update icons:
1. Replace `app-icon.png` in the `frontend/` directory
2. Run `npx @tauri-apps/cli icon app-icon.png`
3. Rebuild the app: `npm run tauri:build`

## Tools

Recommended tools for icon creation:
- [Figma](https://figma.com) - Free design tool
- [GIMP](https://www.gimp.org/) - Free image editor
- [Photoshop](https://www.adobe.com/products/photoshop.html) - Professional editor
- [Icon Slate](https://www.kodlian.com/apps/icon-slate) - macOS icon creator
