import { AutoModel, AutoProcessor, RawImage, Tensor } from '@huggingface/transformers';

/**
 * Background Removal Utility
 * Uses Transformers.js and ONNX Runtime for client-side background removal
 * Based on RMBG-1.4 model for cross-browser compatibility
 */

// Model configuration
const MODEL_ID = 'briaai/RMBG-1.4';
const DEVICE = 'wasm'; // Use WebAssembly for cross-browser support

// Singleton instances
let model: any = null;
let processor: any = null;
let isInitializing = false;

export interface BackgroundRemovalProgress {
  stage: 'loading' | 'processing' | 'compositing' | 'complete';
  progress: number;
  message: string;
}

export type ProgressCallback = (progress: BackgroundRemovalProgress) => void;

/**
 * Initialize the background removal model
 * Model is downloaded once and cached in browser storage
 */
export async function initializeModel(onProgress?: ProgressCallback): Promise<void> {
  // Return early if already initialized
  if (model && processor) {
    return;
  }

  // Prevent concurrent initialization
  if (isInitializing) {
    // Wait for initialization to complete
    while (isInitializing) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return;
  }

  isInitializing = true;

  try {
    onProgress?.({
      stage: 'loading',
      progress: 0,
      message: 'Loading AI model...',
    });

    // Load the model
    model = await AutoModel.from_pretrained(MODEL_ID, {
      device: DEVICE,
    });

    onProgress?.({
      stage: 'loading',
      progress: 50,
      message: 'Loading image processor...',
    });

    // Load the processor
    processor = await AutoProcessor.from_pretrained(MODEL_ID);

    onProgress?.({
      stage: 'loading',
      progress: 100,
      message: 'Model ready!',
    });
  } catch (error) {
    isInitializing = false;
    throw new Error(`Failed to initialize model: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  isInitializing = false;
}

/**
 * Remove background from an image file
 * @param file - Input image file
 * @param onProgress - Optional progress callback
 * @returns New File object with transparent background (PNG format)
 */
export async function removeBackground(
  file: File,
  onProgress?: ProgressCallback
): Promise<File> {
  // Ensure model is initialized
  if (!model || !processor) {
    throw new Error('Model not initialized. Call initializeModel() first.');
  }

  try {
    onProgress?.({
      stage: 'processing',
      progress: 10,
      message: 'Loading image...',
    });

    // Load the image
    const imageUrl = URL.createObjectURL(file);
    const image = await RawImage.fromURL(imageUrl);
    URL.revokeObjectURL(imageUrl);

    onProgress?.({
      stage: 'processing',
      progress: 30,
      message: 'Preprocessing image...',
    });

    // Preprocess the image
    const { pixel_values } = await processor(image);

    onProgress?.({
      stage: 'processing',
      progress: 50,
      message: 'Running AI model...',
    });

    // Run the model
    const { output } = await model({ input: pixel_values });

    onProgress?.({
      stage: 'compositing',
      progress: 70,
      message: 'Creating transparent image...',
    });

    // Post-process the output
    const mask = await extractAlphaMask(output, image.width, image.height);

    onProgress?.({
      stage: 'compositing',
      progress: 85,
      message: 'Finalizing image...',
    });

    // Create canvas and composite the image with alpha mask
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;

    // Draw the original image
    const imageBitmap = await createImageBitmap(file);
    ctx.drawImage(imageBitmap, 0, 0);

    // Apply the alpha mask
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    for (let i = 0; i < mask.length; i++) {
      data[i * 4 + 3] = mask[i]; // Set alpha channel
    }

    ctx.putImageData(imageData, 0, 0);

    onProgress?.({
      stage: 'compositing',
      progress: 95,
      message: 'Converting to PNG...',
    });

    // Convert canvas to blob
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to create blob'));
      }, 'image/png');
    });

    onProgress?.({
      stage: 'complete',
      progress: 100,
      message: 'Background removed!',
    });

    // Create new File object with transparent background
    const originalName = file.name.replace(/\.[^/.]+$/, '');
    return new File([blob], `${originalName}_nobg.png`, {
      type: 'image/png',
    });
  } catch (error) {
    throw new Error(`Failed to remove background: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Extract alpha mask from model output
 * @param output - Model output tensor
 * @param width - Image width
 * @param height - Image height
 * @returns Uint8ClampedArray of alpha values
 */
async function extractAlphaMask(
  output: Tensor,
  width: number,
  height: number
): Promise<Uint8ClampedArray> {
  // Get the output tensor data
  const outputData = output.data as Float32Array;
  const [, , h, w] = output.dims;

  // Create alpha mask
  const mask = new Uint8ClampedArray(width * height);

  // Resize mask if needed
  if (h !== height || w !== width) {
    // Simple nearest-neighbor resize
    const scaleX = w / width;
    const scaleY = h / height;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcX = Math.floor(x * scaleX);
        const srcY = Math.floor(y * scaleY);
        const srcIdx = srcY * w + srcX;
        const value = outputData[srcIdx];
        // Convert from [-1, 1] or [0, 1] range to [0, 255]
        mask[y * width + x] = Math.max(0, Math.min(255, Math.round(value * 255)));
      }
    }
  } else {
    // Direct copy
    for (let i = 0; i < outputData.length; i++) {
      const value = outputData[i];
      mask[i] = Math.max(0, Math.min(255, Math.round(value * 255)));
    }
  }

  return mask;
}

/**
 * Check if browser supports the required features
 */
export function isBackgroundRemovalSupported(): boolean {
  try {
    // Check for required APIs
    const hasCanvas = typeof document !== 'undefined' && !!document.createElement('canvas').getContext('2d');
    const hasCreateImageBitmap = typeof createImageBitmap !== 'undefined';
    const hasBlob = typeof Blob !== 'undefined';

    return hasCanvas && hasCreateImageBitmap && hasBlob;
  } catch {
    return false;
  }
}

/**
 * Cleanup model from memory
 * Call this when component unmounts or feature is no longer needed
 */
export function disposeModel(): void {
  if (model) {
    try {
      model.dispose?.();
    } catch (error) {
      console.warn('Error disposing model:', error);
    }
    model = null;
  }

  if (processor) {
    processor = null;
  }

  isInitializing = false;
}
