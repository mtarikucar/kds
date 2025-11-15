import * as crypto from 'crypto';
import * as ipaddr from 'ipaddr.js';

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
 *
 * Official Iyzico IP ranges (contact Iyzico support to verify)
 * These are example ranges - update with actual Iyzico webhook IPs
 */
const IYZICO_IP_RANGES = [
  // Add official Iyzico IP ranges here
  // Example: '52.58.100.0/24'
  // Contact Iyzico support for their webhook IP ranges
  // You can also configure this via environment variable
];

/**
 * Get configured Iyzico IP ranges from environment or defaults
 */
function getIyzicoIPRanges(): string[] {
  const envRanges = process.env.IYZICO_WEBHOOK_IP_RANGES;
  if (envRanges) {
    return envRanges.split(',').map(range => range.trim());
  }
  return IYZICO_IP_RANGES;
}

/**
 * Check if an IP address is within a CIDR range
 */
function isIPInCIDR(ip: string, cidr: string): boolean {
  try {
    const [range, bits] = cidr.split('/');
    const parsedIP = ipaddr.process(ip);
    const parsedRange = ipaddr.process(range);

    // Check if same IP version (IPv4 or IPv6)
    if (parsedIP.kind() !== parsedRange.kind()) {
      return false;
    }

    // Match against CIDR
    // Cast to any to handle union type issue with ipaddr.js
    return (parsedIP as any).match(parsedRange, parseInt(bits, 10));
  } catch (error) {
    console.error(`Error checking IP ${ip} against CIDR ${cidr}:`, error);
    return false;
  }
}

/**
 * Check if IP is from Iyzico webhook servers
 * Supports both exact IP match and CIDR notation
 */
export function isIyzicoIP(ip: string): boolean {
  const configuredRanges = getIyzicoIPRanges();

  if (configuredRanges.length === 0) {
    // If no IPs configured, skip IP verification (rely on signature only)
    // In production, you should configure IP ranges for defense in depth
    console.warn(
      'No Iyzico IP ranges configured. Relying on signature verification only. ' +
      'Set IYZICO_WEBHOOK_IP_RANGES environment variable for additional security.',
    );
    return true; // Allow if no ranges configured (signature will be checked)
  }

  try {
    // Normalize IP address (handle IPv4-mapped IPv6)
    const normalizedIP = ipaddr.process(ip).toString();

    return configuredRanges.some(range => {
      if (range.includes('/')) {
        // CIDR notation
        return isIPInCIDR(normalizedIP, range);
      } else {
        // Exact IP match
        return normalizedIP === range;
      }
    });
  } catch (error) {
    console.error(`Error validating IP ${ip}:`, error);
    return false;
  }
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
