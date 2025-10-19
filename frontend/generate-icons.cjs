// Simple icon generator using Canvas (node-canvas would be needed, but let's try a simpler approach)
const fs = require('fs');
const path = require('path');

// Create a simple ICO file (16x16, 32x32 icons embedded)
// This is a minimal valid ICO file with a blue square
const createSimpleICO = () => {
  // ICO header
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type (1 = ICO)
  header.writeUInt16LE(1, 4); // Number of images

  // ICO directory entry for 32x32
  const dirEntry = Buffer.alloc(16);
  dirEntry.writeUInt8(32, 0);  // Width
  dirEntry.writeUInt8(32, 1);  // Height
  dirEntry.writeUInt8(0, 2);   // Color palette
  dirEntry.writeUInt8(0, 3);   // Reserved
  dirEntry.writeUInt16LE(1, 4); // Color planes
  dirEntry.writeUInt16LE(32, 6); // Bits per pixel

  // Simple 32x32 RGBA bitmap data (blue square)
  const width = 32, height = 32;
  const imageData = Buffer.alloc(40 + width * height * 4); // BMP header + pixel data

  // BMP Info Header
  imageData.writeUInt32LE(40, 0); // Header size
  imageData.writeInt32LE(width, 4); // Width
  imageData.writeInt32LE(height * 2, 8); // Height * 2 for ICO
  imageData.writeUInt16LE(1, 12); // Planes
  imageData.writeUInt16LE(32, 14); // Bits per pixel
  imageData.writeUInt32LE(0, 16); // Compression
  imageData.writeUInt32LE(width * height * 4, 20); // Image size

  // Fill with blue color (BGRA format)
  let offset = 40;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      imageData.writeUInt8(255, offset++); // Blue
      imageData.writeUInt8(100, offset++); // Green
      imageData.writeUInt8(50, offset++);  // Red
      imageData.writeUInt8(255, offset++); // Alpha
    }
  }

  const imageSize = imageData.length;
  dirEntry.writeUInt32LE(imageSize, 8); // Size of image data
  dirEntry.writeUInt32LE(22, 12); // Offset to image data (6 header + 16 dir entry)

  return Buffer.concat([header, dirEntry, imageData]);
};

// Create a simple PNG file (very basic, single color)
const createSimplePNG = (size) => {
  // This is a minimal valid PNG - 1x1 red pixel, we'll just use it as placeholder
  const pngData = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 dimensions
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, // IDAT chunk
    0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
    0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xDD, 0x8D,
    0xB4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, // IEND chunk
    0x44, 0xAE, 0x42, 0x60, 0x82
  ]);
  return pngData;
};

// Create icons directory
const iconsDir = path.join(__dirname, 'src-tauri', 'icons');

try {
  // Create PNG files
  fs.writeFileSync(path.join(iconsDir, '32x32.png'), createSimplePNG(32));
  fs.writeFileSync(path.join(iconsDir, '128x128.png'), createSimplePNG(128));
  fs.writeFileSync(path.join(iconsDir, '128x128@2x.png'), createSimplePNG(256));
  fs.writeFileSync(path.join(iconsDir, 'icon.png'), createSimplePNG(512));

  // Create ICO file
  fs.writeFileSync(path.join(iconsDir, 'icon.ico'), createSimpleICO());

  // Create a simple ICNS (macOS) - just copy the PNG for now as placeholder
  fs.writeFileSync(path.join(iconsDir, 'icon.icns'), createSimplePNG(512));

  console.log('Icons generated successfully!');
} catch (error) {
  console.error('Error generating icons:', error);
  process.exit(1);
}
