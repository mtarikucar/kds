import { describe, it, expect } from 'vitest';
import { assetUrl, ASSETS_ORIGIN, API_URL } from './env';

/**
 * assetUrl resolves possibly-relative upload paths against the backend
 * origin. The branch table is load-bearing: absolute/data/blob URLs must
 * pass through untouched (double-prefixing would 404 every product image),
 * empty/nullish must collapse to '', and relative paths get a single
 * leading slash before the origin. These assertions are env-agnostic: they
 * pin assetUrl's output against the module's own derived ASSETS_ORIGIN
 * (whatever VITE_API_URL resolves to), so the suite is deterministic
 * regardless of the ambient API URL.
 */
describe('env module constants', () => {
  it('derives ASSETS_ORIGIN by stripping the /api suffix from API_URL', () => {
    // Relation, not an ambient absolute: ASSETS_ORIGIN is API_URL without /api.
    expect(ASSETS_ORIGIN).toBe(API_URL.replace(/\/api$/, ''));
    expect(ASSETS_ORIGIN).not.toMatch(/\/api$/);
  });
});

describe('assetUrl', () => {
  it('returns empty string for null / undefined / empty', () => {
    expect(assetUrl(null)).toBe('');
    expect(assetUrl(undefined)).toBe('');
    expect(assetUrl('')).toBe('');
  });

  it('prefixes a root-relative path with the assets origin (single slash)', () => {
    expect(assetUrl('/uploads/products/foo.jpg')).toBe(
      `${ASSETS_ORIGIN}/uploads/products/foo.jpg`,
    );
  });

  it('adds the missing leading slash for a bare relative path', () => {
    expect(assetUrl('uploads/x.png')).toBe(
      `${ASSETS_ORIGIN}/uploads/x.png`,
    );
  });

  it.each([
    'http://cdn.example.com/a.jpg',
    'https://cdn.example.com/a.jpg',
    'data:image/png;base64,AAAA',
    'blob:http://localhost:3000/abc-123',
  ])('passes absolute / data / blob URLs through unchanged: %s', (url) => {
    expect(assetUrl(url)).toBe(url);
  });

  it('does not double-prefix an https URL', () => {
    const url = 'https://images.cdn/path/img.webp';
    expect(assetUrl(url)).not.toContain('localhost');
    expect(assetUrl(url)).toBe(url);
  });
});
