import { describe, it, expect } from 'vitest';
import { assetUrl, ASSETS_ORIGIN, API_URL } from './env';

/**
 * assetUrl resolves possibly-relative upload paths against the backend
 * origin. The branch table is load-bearing: absolute/data/blob URLs must
 * pass through untouched (double-prefixing would 404 every product image),
 * empty/nullish must collapse to '', and relative paths get a single
 * leading slash before the origin. In the test env ASSETS_ORIGIN resolves
 * to http://localhost:3000 (no VITE_API_URL set), and we pin against it.
 */
describe('env module constants', () => {
  it('derives ASSETS_ORIGIN by stripping the /api suffix from API_URL', () => {
    expect(API_URL).toBe('http://localhost:3000/api');
    expect(ASSETS_ORIGIN).toBe('http://localhost:3000');
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
      'http://localhost:3000/uploads/products/foo.jpg',
    );
  });

  it('adds the missing leading slash for a bare relative path', () => {
    expect(assetUrl('uploads/x.png')).toBe(
      'http://localhost:3000/uploads/x.png',
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
