import { describe, it, expect, vi, beforeEach } from 'vitest';

// The transformers runtime is heavy + downloads a model; stub it so the
// pure logic (guards, support detection, dispose) is unit-testable.
vi.mock('@huggingface/transformers', () => ({
  AutoModel: { from_pretrained: vi.fn() },
  AutoProcessor: { from_pretrained: vi.fn() },
  RawImage: { fromURL: vi.fn() },
  Tensor: class {},
}));

import {
  removeBackground,
  isBackgroundRemovalSupported,
  disposeModel,
} from './backgroundRemoval';

describe('backgroundRemoval', () => {
  beforeEach(() => {
    // Reset the module singleton state between tests.
    disposeModel();
  });

  it('removeBackground rejects when the model is not initialized', async () => {
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    await expect(removeBackground(file)).rejects.toThrow(
      /Model not initialized/,
    );
  });

  it('isBackgroundRemovalSupported returns a boolean and never throws', () => {
    // jsdom does not implement a real 2d canvas context, so this resolves to
    // false here — the key contract is that the feature-probe degrades safely
    // (returns a boolean rather than throwing) when an API is missing.
    (globalThis as any).createImageBitmap = vi.fn();
    expect(typeof isBackgroundRemovalSupported()).toBe('boolean');
  });

  it('isBackgroundRemovalSupported is false when createImageBitmap is unavailable', () => {
    const original = (globalThis as any).createImageBitmap;
    // Force a canvas context so only the createImageBitmap branch decides.
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({} as never);
    delete (globalThis as any).createImageBitmap;
    expect(isBackgroundRemovalSupported()).toBe(false);
    getContextSpy.mockRestore();
    (globalThis as any).createImageBitmap = original;
  });

  it('isBackgroundRemovalSupported is true when all required APIs exist', () => {
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({} as never);
    (globalThis as any).createImageBitmap = vi.fn();
    expect(isBackgroundRemovalSupported()).toBe(true);
    getContextSpy.mockRestore();
  });

  it('disposeModel is safe to call repeatedly (idempotent)', () => {
    expect(() => {
      disposeModel();
      disposeModel();
    }).not.toThrow();
  });
});
