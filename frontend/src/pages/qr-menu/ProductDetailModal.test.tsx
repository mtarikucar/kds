import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Product } from '../../types';
import ProductDetailModal from './ProductDetailModal';

/**
 * Specs for the read-only QR product detail modal. Focus on its real
 * branches: open/closed + null-product gating, the show* visibility
 * toggles (price / description / images), the stock-tracked panel, the
 * availability badge (note the INVERTED ternary — `!isAvailable` maps to
 * the "available" label), image-URL normalization (absolute vs relative
 * vs backslash Windows path), and the Escape-to-close keyboard handler.
 */

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    name: 'Pizza',
    description: 'Wood fired',
    price: 19.5,
    image: null,
    images: [],
    modifierGroups: [],
    categoryId: 'c1',
    currentStock: 7,
    stockTracked: false,
    isAvailable: true,
    displayOrder: 0,
    tenantId: 't1',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  primaryColor: '#ff0000',
  secondaryColor: '#00ff00',
  showImages: true,
  showDescription: true,
  showPrices: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  document.body.style.overflow = '';
});

describe('ProductDetailModal — render gating', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <ProductDetailModal {...baseProps} isOpen={false} product={makeProduct()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when product is null even if open', () => {
    const { container } = render(
      <ProductDetailModal {...baseProps} product={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the product name when open', () => {
    render(<ProductDetailModal {...baseProps} product={makeProduct({ name: 'Margherita' })} />);
    expect(screen.getByRole('heading', { name: 'Margherita' })).toBeInTheDocument();
  });
});

describe('ProductDetailModal — money + visibility toggles', () => {
  it('formats the price in Turkish Lira when showPrices is on', () => {
    render(<ProductDetailModal {...baseProps} product={makeProduct({ price: 19.5 })} />);
    expect(screen.getByText('₺19,50')).toBeInTheDocument();
  });

  it('hides the price block when showPrices is off', () => {
    render(<ProductDetailModal {...baseProps} showPrices={false} product={makeProduct({ price: 19.5 })} />);
    expect(screen.queryByText('₺19,50')).not.toBeInTheDocument();
  });

  it('shows description when present and showDescription is on', () => {
    render(<ProductDetailModal {...baseProps} product={makeProduct({ description: 'Wood fired' })} />);
    expect(screen.getByText('Wood fired')).toBeInTheDocument();
  });

  it('falls back to the "no description" copy when description is empty', () => {
    render(<ProductDetailModal {...baseProps} product={makeProduct({ description: null })} />);
    // common.qrMenu.noDescription resolves to a non-empty string
    expect(screen.queryByText('Wood fired')).not.toBeInTheDocument();
  });
});

describe('ProductDetailModal — availability badge (inverted ternary)', () => {
  it('an UNAVAILABLE product shows the "Available" label (per the code\'s !isAvailable)', () => {
    render(<ProductDetailModal {...baseProps} product={makeProduct({ isAvailable: false })} />);
    expect(screen.getByText('Available')).toBeInTheDocument();
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
  });

  it('an AVAILABLE product shows the "Unavailable" label', () => {
    render(<ProductDetailModal {...baseProps} product={makeProduct({ isAvailable: true })} />);
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Available')).not.toBeInTheDocument();
  });

  it('does not render the badge at all when images are hidden', () => {
    render(<ProductDetailModal {...baseProps} showImages={false} product={makeProduct({ isAvailable: false })} />);
    expect(screen.queryByText('Available')).not.toBeInTheDocument();
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
  });
});

describe('ProductDetailModal — stock panel', () => {
  it('shows current stock only when stockTracked is true', () => {
    render(<ProductDetailModal {...baseProps} product={makeProduct({ stockTracked: true, currentStock: 42 })} />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('omits the stock number when stockTracked is false', () => {
    render(<ProductDetailModal {...baseProps} product={makeProduct({ stockTracked: false, currentStock: 42 })} />);
    expect(screen.queryByText('42')).not.toBeInTheDocument();
  });
});

describe('ProductDetailModal — image URL normalization', () => {
  function imgSrc(): string | null {
    const img = document.querySelector('img');
    return img?.getAttribute('src') ?? null;
  }

  it('keeps an already-absolute https URL untouched', () => {
    render(
      <ProductDetailModal {...baseProps} product={makeProduct({ image: 'https://cdn.example.com/a.jpg' })} />,
    );
    expect(imgSrc()).toBe('https://cdn.example.com/a.jpg');
  });

  it('rewrites Windows backslashes to forward slashes and prepends the API base', () => {
    render(
      <ProductDetailModal {...baseProps} product={makeProduct({ image: 'uploads\\pics\\b.jpg' })} />,
    );
    const src = imgSrc();
    expect(src).not.toContain('\\');
    expect(src).toContain('uploads/pics/b.jpg');
    expect(src).not.toContain('//uploads'); // leading slash collapse avoided
  });

  it('strips a single leading slash so the base join has no double slash', () => {
    render(
      <ProductDetailModal {...baseProps} product={makeProduct({ image: '/uploads/c.jpg' })} />,
    );
    const src = imgSrc()!;
    expect(src.endsWith('/uploads/c.jpg')).toBe(true);
    expect(src.includes('//uploads')).toBe(false);
  });

  it('falls back to images[0].url when the legacy image field is null', () => {
    render(
      <ProductDetailModal
        {...baseProps}
        product={makeProduct({
          image: null,
          images: [
            { id: 'i1', url: 'https://cdn.example.com/first.jpg', filename: 'f', size: 1, mimeType: 'image/jpeg', tenantId: 't1', createdAt: '' },
          ],
        })}
      />,
    );
    expect(imgSrc()).toBe('https://cdn.example.com/first.jpg');
  });

  it('renders the placeholder icon (no <img>) when there is no image', () => {
    render(<ProductDetailModal {...baseProps} product={makeProduct({ image: null, images: [] })} />);
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('ProductDetailModal — interactions', () => {
  it('calls onClose on Escape keydown while open', () => {
    const onClose = vi.fn();
    render(<ProductDetailModal {...baseProps} onClose={onClose} product={makeProduct()} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores non-Escape keys', () => {
    const onClose = vi.fn();
    render(<ProductDetailModal {...baseProps} onClose={onClose} product={makeProduct()} />);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('locks body scroll while open and restores it on unmount', () => {
    const { unmount } = render(<ProductDetailModal {...baseProps} product={makeProduct()} />);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('unset');
  });

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<ProductDetailModal {...baseProps} onClose={onClose} product={makeProduct()} />);
    // The backdrop is the fixed inset-0 overlay div with an onClick.
    const backdrop = document.querySelector('.fixed.inset-0.bg-black\\/60');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
