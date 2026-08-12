import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProductImageField from './ProductImageField';

/**
 * Uploading a photo used to mean leaving the product entirely: a global
 * "Görseller" tab was the only place that accepted a file, and the library
 * modal the product offered could only pick from what was already there. The
 * field itself has to accept the file, or the round trip comes back.
 */
const uploadMock = vi.fn();
vi.mock('../../features/upload/uploadApi', () => ({
  useUploadProductImages: () => ({ mutateAsync: uploadMock, isPending: false }),
}));
vi.mock('./ImageLibraryModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="library" /> : null,
}));
vi.mock('../../pages/admin/menuManagement/imageUrl', () => ({
  getImageUrl: (u: string) => u,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) =>
      typeof opts === 'object' && opts?.defaultValue
        ? String(opts.defaultValue).replace('{{name}}', opts.name ?? '').replace('{{mb}}', opts.mb ?? '')
        : key,
  }),
}));
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (m: string) => toastError(m) } }));

const image = (id: string) => ({
  id,
  url: `/${id}.jpg`,
  filename: `${id}.jpg`,
  size: 1,
  mimeType: 'image/jpeg',
  tenantId: 't',
  createdAt: '2026-01-01',
});

const file = (name: string, size: number, type = 'image/jpeg') => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

beforeEach(() => {
  uploadMock.mockReset().mockResolvedValue({ images: [image('new')], count: 1 });
  toastError.mockReset();
});

describe('ProductImageField', () => {
  it('uploads a dropped file and attaches it to the product', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <ProductImageField images={[]} onChange={onChange} />,
    );

    const zone = container.firstElementChild!.firstElementChild!;
    fireEvent.drop(zone, { dataTransfer: { files: [file('a.jpg', 1000)] } });

    await waitFor(() => expect(uploadMock).toHaveBeenCalled());
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'new' }),
    ]);
  });

  it('appends rather than replacing, so the cover photo does not change', async () => {
    // images[0] is the cover everywhere else (QR menu, POS). An upload that
    // replaced the array would silently promote the newest file.
    const onChange = vi.fn();
    const { container } = render(
      <ProductImageField images={[image('old')]} onChange={onChange} />,
    );

    fireEvent.drop(container.firstElementChild!.firstElementChild!, {
      dataTransfer: { files: [file('b.jpg', 1000)] },
    });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[0][0].map((i: any) => i.id)).toEqual(['old', 'new']);
  });

  it('refuses an oversized file before the round trip', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <ProductImageField images={[]} onChange={onChange} />,
    );

    fireEvent.drop(container.firstElementChild!.firstElementChild!, {
      dataTransfer: { files: [file('huge.jpg', 20 * 1024 * 1024)] },
    });

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('refuses a non-image', async () => {
    const { container } = render(
      <ProductImageField images={[]} onChange={vi.fn()} />,
    );

    fireEvent.drop(container.firstElementChild!.firstElementChild!, {
      dataTransfer: { files: [file('notes.pdf', 100, 'application/pdf')] },
    });

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('promotes a photo to cover without duplicating it', () => {
    const onChange = vi.fn();
    render(
      <ProductImageField
        images={[image('a'), image('b')]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByTitle('Kapak yap'));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'b' }),
      expect.objectContaining({ id: 'a' }),
    ]);
  });

  it('removes a photo', () => {
    const onChange = vi.fn();
    render(<ProductImageField images={[image('a'), image('b')]} onChange={onChange} />);

    fireEvent.click(screen.getAllByTitle('Kaldır')[0]);
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ id: 'b' })]);
  });

  it('still offers the library as a second source', () => {
    render(<ProductImageField images={[]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByText('Kitaplıktan seç'));
    expect(screen.getByTestId('library')).toBeInTheDocument();
  });

  it('shows a legacy single-URL photo instead of an empty state', () => {
    // Products saved before the gallery existed carry one URL. Hiding it would
    // tell the operator there is no photo while the guest sees one.
    render(
      <ProductImageField images={[]} onChange={vi.fn()} legacyImageUrl="/legacy.jpg" />,
    );
    expect(document.querySelector('img[src="/legacy.jpg"]')).not.toBeNull();
  });
});
