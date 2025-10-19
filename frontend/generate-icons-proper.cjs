const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

// Create a PNG with proper RGBA format
function createRGBAPNG(size, outputPath) {
  const png = new PNG({ width: size, height: size });

  // Fill with a gradient blue color
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;

      // Create a simple gradient effect
      const centerX = size / 2;
      const centerY = size / 2;
      const distance = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));
      const maxDistance = Math.sqrt(Math.pow(centerX, 2) + Math.pow(centerY, 2));
      const factor = 1 - (distance / maxDistance);

      // RGBA: Blue gradient
      png.data[idx] = Math.floor(50 + factor * 100);   // Red
      png.data[idx + 1] = Math.floor(100 + factor * 100); // Green
      png.data[idx + 2] = Math.floor(200 + factor * 55);  // Blue
      png.data[idx + 3] = 255; // Alpha (fully opaque)
    }
  }

  png.pack().pipe(fs.createWriteStream(outputPath));

  return new Promise((resolve, reject) => {
    png.on('end', resolve);
    png.on('error', reject);
  });
}

// Create ICO file from PNG
function createICOFromPNG(pngPath, icoPath, size = 32) {
  // Read the PNG file
  const pngBuffer = fs.readFileSync(pngPath);
  const png = PNG.sync.read(pngBuffer);

  // ICO file structure
  const iconDir = Buffer.alloc(6);
  iconDir.writeUInt16LE(0, 0);      // Reserved (0)
  iconDir.writeUInt16LE(1, 2);      // Type (1 = ICO)
  iconDir.writeUInt16LE(1, 4);      // Number of images

  // Icon directory entry
  const dirEntry = Buffer.alloc(16);
  dirEntry.writeUInt8(size, 0);     // Width
  dirEntry.writeUInt8(size, 1);     // Height
  dirEntry.writeUInt8(0, 2);        // Color palette (0 = no palette)
  dirEntry.writeUInt8(0, 3);        // Reserved
  dirEntry.writeUInt16LE(1, 4);     // Color planes
  dirEntry.writeUInt16LE(32, 6);    // Bits per pixel

  // Create BMP data for ICO
  const bmpInfoHeaderSize = 40;
  const imageDataSize = size * size * 4;
  const totalImageSize = bmpInfoHeaderSize + imageDataSize;

  const bmpInfoHeader = Buffer.alloc(bmpInfoHeaderSize);
  bmpInfoHeader.writeUInt32LE(bmpInfoHeaderSize, 0);  // Header size
  bmpInfoHeader.writeInt32LE(size, 4);                // Width
  bmpInfoHeader.writeInt32LE(size * 2, 8);            // Height (doubled for ICO)
  bmpInfoHeader.writeUInt16LE(1, 12);                 // Planes
  bmpInfoHeader.writeUInt16LE(32, 14);                // Bits per pixel
  bmpInfoHeader.writeUInt32LE(0, 16);                 // Compression
  bmpInfoHeader.writeUInt32LE(imageDataSize, 20);     // Image size

  // Convert RGBA to BGRA and flip vertically
  const imageData = Buffer.alloc(imageDataSize);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const srcIdx = (size * (size - 1 - y) + x) << 2;
      const dstIdx = (size * y + x) << 2;
      imageData[dstIdx] = png.data[srcIdx + 2];     // B
      imageData[dstIdx + 1] = png.data[srcIdx + 1]; // G
      imageData[dstIdx + 2] = png.data[srcIdx];     // R
      imageData[dstIdx + 3] = png.data[srcIdx + 3]; // A
    }
  }

  dirEntry.writeUInt32LE(totalImageSize, 8);        // Size of image data
  dirEntry.writeUInt32LE(22, 12);                   // Offset (6 + 16)

  const icoBuffer = Buffer.concat([iconDir, dirEntry, bmpInfoHeader, imageData]);
  fs.writeFileSync(icoPath, icoBuffer);
}

// Main execution
async function generateIcons() {
  const iconsDir = path.join(__dirname, 'src-tauri', 'icons');

  try {
    console.log('Generating PNG icons...');

    // Generate all required PNG sizes
    await createRGBAPNG(32, path.join(iconsDir, '32x32.png'));
    await createRGBAPNG(128, path.join(iconsDir, '128x128.png'));
    await createRGBAPNG(256, path.join(iconsDir, '128x128@2x.png'));
    await createRGBAPNG(512, path.join(iconsDir, 'icon.png'));

    // Wait a bit for file system to sync
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('Generating ICO file...');
    createICOFromPNG(path.join(iconsDir, '32x32.png'), path.join(iconsDir, 'icon.ico'), 32);

    console.log('Generating ICNS placeholder...');
    // For ICNS, just copy the largest PNG as placeholder
    fs.copyFileSync(
      path.join(iconsDir, 'icon.png'),
      path.join(iconsDir, 'icon.icns')
    );

    console.log('All icons generated successfully!');
  } catch (error) {
    console.error('Error generating icons:', error);
    process.exit(1);
  }
}

generateIcons();
