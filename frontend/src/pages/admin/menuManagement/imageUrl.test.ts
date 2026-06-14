import { describe, it, expect } from 'vitest';
import { getImageUrl } from './imageUrl';

describe('getImageUrl', () => {
  it('returns an absolute http URL unchanged', () => {
    expect(getImageUrl('http://cdn.example.com/a.png')).toBe(
      'http://cdn.example.com/a.png',
    );
  });

  it('returns an absolute https URL unchanged', () => {
    expect(getImageUrl('https://cdn.example.com/a.png')).toBe(
      'https://cdn.example.com/a.png',
    );
  });

  it('prefixes a relative path with the API base url', () => {
    // In the vitest env VITE_API_BASE_URL is unset, so the localhost fallback applies.
    expect(getImageUrl('/uploads/a.png')).toBe('http://localhost:3000/uploads/a.png');
  });
});
