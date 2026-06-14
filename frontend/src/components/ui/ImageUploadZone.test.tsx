import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the heavy background-removal lib so the component is unit-testable
// without pulling in the ML runtime. Default: feature unsupported.
const isSupported = vi.fn(() => false);
vi.mock('../../lib/backgroundRemoval', () => ({
  initializeModel: vi.fn(),
  removeBackground: vi.fn(),
  isBackgroundRemovalSupported: () => isSupported(),
  disposeModel: vi.fn(),
}));

import ImageUploadZone from './ImageUploadZone';

function makeFile(name: string, type: string, sizeBytes: number): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: sizeBytes });
  return file;
}

beforeEach(() => {
  isSupported.mockReturnValue(false);
  // jsdom doesn't implement createObjectURL/revokeObjectURL
  global.URL.createObjectURL = vi.fn(() => 'blob:preview');
  global.URL.revokeObjectURL = vi.fn();
});

describe('ImageUploadZone', () => {
  it('renders the drop zone prompt', () => {
    render(<ImageUploadZone onFilesSelected={() => {}} />);
    expect(
      screen.getByText(/Drop images here or click to browse/i),
    ).toBeInTheDocument();
  });

  it('accepts a valid image and calls onFilesSelected', () => {
    const onFilesSelected = vi.fn();
    const { container } = render(
      <ImageUploadZone onFilesSelected={onFilesSelected} />,
    );
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = makeFile('photo.png', 'image/png', 1024);
    fireEvent.change(input, { target: { files: [file] } });
    expect(onFilesSelected).toHaveBeenCalledWith([file]);
    expect(screen.getByText(/Selected Files \(1\)/)).toBeInTheDocument();
  });

  it('rejects an invalid file type and shows an error', () => {
    const onFilesSelected = vi.fn();
    const { container } = render(
      <ImageUploadZone onFilesSelected={onFilesSelected} />,
    );
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = makeFile('doc.pdf', 'application/pdf', 1024);
    fireEvent.change(input, { target: { files: [file] } });
    expect(onFilesSelected).not.toHaveBeenCalled();
    expect(screen.getByText(/Invalid file type/i)).toBeInTheDocument();
  });

  it('rejects files exceeding the size limit', () => {
    const onFilesSelected = vi.fn();
    const { container } = render(
      <ImageUploadZone onFilesSelected={onFilesSelected} maxSizeMB={1} />,
    );
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = makeFile('big.png', 'image/png', 2 * 1024 * 1024);
    fireEvent.change(input, { target: { files: [file] } });
    expect(onFilesSelected).not.toHaveBeenCalled();
    expect(screen.getByText(/exceeds 1MB limit/i)).toBeInTheDocument();
  });

  it('does not call onFilesSelected immediately in confirmation mode', () => {
    const onFilesSelected = vi.fn();
    const onUploadConfirm = vi.fn();
    const { container } = render(
      <ImageUploadZone
        onFilesSelected={onFilesSelected}
        requireConfirmation
        onUploadConfirm={onUploadConfirm}
      />,
    );
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = makeFile('photo.png', 'image/png', 1024);
    fireEvent.change(input, { target: { files: [file] } });
    expect(onFilesSelected).not.toHaveBeenCalled();

    // Confirm button now appears
    fireEvent.click(screen.getByText(/Upload 1 Image/i));
    expect(onUploadConfirm).toHaveBeenCalledWith([file]);
  });

  it('hides the AI toggle when background removal is unsupported', () => {
    render(<ImageUploadZone onFilesSelected={() => {}} />);
    expect(screen.queryByText(/Remove Background/i)).not.toBeInTheDocument();
  });
});
