// Utility function to check if Google OAuth is properly configured
export const isGoogleAuthAvailable = (): boolean => {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

  // Check if client ID exists and has valid format
  // Valid format: ends with .apps.googleusercontent.com and doesn't contain @
  return Boolean(
    clientId &&
    !clientId.includes('@') &&
    clientId.endsWith('.apps.googleusercontent.com')
  );
};
