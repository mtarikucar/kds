import { Request } from 'express';
import { isIP } from 'net';

/**
 * Extract client IP address from request
 * Handles various proxy configurations and headers
 * Priority: CF-Connecting-IP > X-Real-IP > X-Forwarded-For > X-Client-IP > socket
 */
export function getClientIp(req: Request): string {
  // Check for CF-Connecting-IP header first (Cloudflare — most trustworthy, set by Cloudflare itself)
  const cfIp = req.headers['cf-connecting-ip'];
  if (cfIp && typeof cfIp === 'string' && isIP(cfIp)) {
    return cfIp;
  }

  // Check for X-Real-IP header (nginx)
  const realIp = req.headers['x-real-ip'];
  if (realIp && typeof realIp === 'string' && isIP(realIp)) {
    return realIp;
  }

  // Check for X-Forwarded-For header (most common with proxies/load balancers)
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    const ips = typeof forwardedFor === 'string' ? forwardedFor.split(',') : forwardedFor;
    const clientIp = ips[0].trim();
    if (isIP(clientIp)) {
      return clientIp;
    }
  }

  // Check for X-Client-IP header
  const clientIpHeader = req.headers['x-client-ip'];
  if (clientIpHeader && typeof clientIpHeader === 'string' && isIP(clientIpHeader)) {
    return clientIpHeader;
  }

  // Fall back to socket remote address
  const socketIp = req.socket?.remoteAddress;
  if (socketIp) {
    // Handle IPv6 mapped IPv4 addresses
    if (socketIp.startsWith('::ffff:')) {
      return socketIp.substring(7);
    }
    return socketIp;
  }

  return '0.0.0.0';
}

/**
 * Check if IP is from a private network (IPv4 and IPv6)
 */
export function isPrivateIp(ip: string): boolean {
  // IPv6 private ranges
  if (ip === '::1') return true; // loopback
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // ULA (fc00::/7)
  if (ip.startsWith('fe80')) return true; // link-local (fe80::/10)

  // IPv4 ranges
  const parts = ip.split('.').map(part => parseInt(part, 10));

  if (parts.length !== 4) {
    return false;
  }

  // 10.0.0.0/8
  if (parts[0] === 10) return true;
  // 172.16.0.0/12
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // 192.168.0.0/16
  if (parts[0] === 192 && parts[1] === 168) return true;
  // 127.0.0.0/8 (loopback)
  if (parts[0] === 127) return true;

  return false;
}

/**
 * Get production-safe IP address
 * Warns if using private/local IP in production
 */
export function getProductionSafeIp(req: Request): string {
  const ip = getClientIp(req);

  if (process.env.NODE_ENV === 'production' && isPrivateIp(ip)) {
    console.warn(
      `[IP Detection] Private IP detected in production: ${ip}. ` +
      `Check your proxy/load balancer configuration to forward real client IPs.`
    );
  }

  return ip;
}
