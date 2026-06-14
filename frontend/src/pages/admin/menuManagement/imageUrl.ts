// Resolves a (possibly relative) image URL to an absolute one. Absolute
// http(s) URLs are returned unchanged; relative paths are prefixed with the
// configured API base URL (falling back to localhost in dev). Extracted so the
// prefixing rule is unit-testable and shared between the image library tab and
// the product modal.
export const getImageUrl = (url: string): string => {
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'}${url}`;
};
