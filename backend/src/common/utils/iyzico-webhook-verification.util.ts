import * as crypto from 'crypto';

/**
 * Verify Iyzico webhook signature using HMAC-SHA256
 *
 * Since Iyzico doesn't provide built-in signature verification like Stripe,
 * we implement our own HMAC-based verification.
 *
 * IMPORTANT: Configure the same secret in Iyzico merchant panel webhook settings
 */
export function verifyIyzicoWebhookSignature(
  payload: string | Buffer,
  receivedSignature: string,
  secret: string,
): boolean {
  if (!secret) {
    throw new Error('Webhook secret not configured');
  }

  if (!receivedSignature) {
    return false;
  }

  // Convert payload to string if it's a buffer
  const payloadString = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;

  // Calculate HMAC signature
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payloadString);
  const calculatedSignature = hmac.digest('hex');

  // Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(calculatedSignature, 'hex'),
      Buffer.from(receivedSignature, 'hex'),
    );
  } catch (error) {
    // If lengths don't match, timingSafeEqual throws
    return false;
  }
}

/**
 * Generate webhook signature for testing
 * Use this in your tests to generate valid signatures
 */
export function generateIyzicoWebhookSignature(
  payload: string | Buffer,
  secret: string,
): string {
  const payloadString = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payloadString);
  return hmac.digest('hex');
}

/**
 * Alternative: IP-based verification for Iyzico
 * Use this if Iyzico provides static IP ranges
 */
const IYZICO_IP_RANGES = [
  // Add official Iyzico IP ranges here
  // Example: '52.58.100.0/24'
  // Contact Iyzico support for their webhook IP ranges
];

export function isIyzicoIP(ip: string): boolean {
  // Simple check - for production, use a proper IP range library
  // like 'ip-range-check' or 'ipaddr.js'

  if (IYZICO_IP_RANGES.length === 0) {
    // If no IPs configured, return false (don't allow)
    console.warn('No Iyzico IP ranges configured for webhook verification');
    return false;
  }

  // TODO: Implement proper IP range checking
  // For now, just check exact matches (not recommended for production)
  return IYZICO_IP_RANGES.some(range => {
    if (range.includes('/')) {
      // CIDR notation - need proper library to check
      console.warn('CIDR range checking not implemented, use signature verification');
      return false;
    }
    return ip === range;
  });
}

/**
 * Verify Iyzico webhook using both signature and IP
 * Most secure approach
 */
export function verifyIyzicoWebhook(
  payload: string | Buffer,
  signature: string,
  secret: string,
  clientIp?: string,
): { valid: boolean; reason?: string } {
  // Check signature first (primary verification)
  const signatureValid = verifyIyzicoWebhookSignature(payload, signature, secret);

  if (!signatureValid) {
    return { valid: false, reason: 'Invalid signature' };
  }

  // Optional: Also verify IP if configured
  if (clientIp && IYZICO_IP_RANGES.length > 0) {
    const ipValid = isIyzicoIP(clientIp);
    if (!ipValid) {
      return { valid: false, reason: 'Invalid IP address' };
    }
  }

  return { valid: true };
}
