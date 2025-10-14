import { Request } from 'express';

/**
 * Extract client IP address from request
 * Handles various proxy configurations and headers
 */
export function getClientIp(req: Request): string {
  // Check for X-Forwarded-For header (most common with proxies/load balancers)
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    // X-Forwarded-For can contain multiple IPs, take the first one (original client)
    const ips = typeof forwardedFor === 'string' ? forwardedFor.split(',') : forwardedFor;
    const clientIp = ips[0].trim();
    if (isValidIp(clientIp)) {
      return clientIp;
    }
  }

  // Check for X-Real-IP header (nginx)
  const realIp = req.headers['x-real-ip'];
  if (realIp && typeof realIp === 'string' && isValidIp(realIp)) {
    return realIp;
  }

  // Check for CF-Connecting-IP header (Cloudflare)
  const cfIp = req.headers['cf-connecting-ip'];
  if (cfIp && typeof cfIp === 'string' && isValidIp(cfIp)) {
    return cfIp;
  }

  // Check for X-Client-IP header
  const clientIpHeader = req.headers['x-client-ip'];
  if (clientIpHeader && typeof clientIpHeader === 'string' && isValidIp(clientIpHeader)) {
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

  // Last resort: return a default IP (should never happen in production)
  // This is a fallback that indicates IP detection failed
  return '0.0.0.0';
}

/**
 * Validate IP address format
 */
function isValidIp(ip: string): boolean {
  // IPv4 validation
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Regex.test(ip)) {
    const parts = ip.split('.');
    return parts.every(part => {
      const num = parseInt(part, 10);
      return num >= 0 && num <= 255;
    });
  }

  // IPv6 validation (basic)
  const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
  return ipv6Regex.test(ip);
}

/**
 * Check if IP is from a private network
 */
export function isPrivateIp(ip: string): boolean {
  // Private IPv4 ranges:
  // 10.0.0.0 - 10.255.255.255
  // 172.16.0.0 - 172.31.255.255
  // 192.168.0.0 - 192.168.255.255
  // 127.0.0.0 - 127.255.255.255 (loopback)

  const parts = ip.split('.').map(part => parseInt(part, 10));

  if (parts.length !== 4) {
    return false; // Not IPv4
  }

  // 10.0.0.0/8
  if (parts[0] === 10) {
    return true;
  }

  // 172.16.0.0/12
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
    return true;
  }

  // 192.168.0.0/16
  if (parts[0] === 192 && parts[1] === 168) {
    return true;
  }

  // 127.0.0.0/8 (loopback)
  if (parts[0] === 127) {
    return true;
  }

  return false;
}

/**
 * Get production-safe IP address
 * Warns if using private/local IP in production
 */
export function getProductionSafeIp(req: Request): string {
  const ip = getClientIp(req);

  // In production, warn if we detect a private IP
  if (process.env.NODE_ENV === 'production' && isPrivateIp(ip)) {
    console.warn(
      `[IP Detection] Private IP detected in production: ${ip}. ` +
      `Check your proxy/load balancer configuration to forward real client IPs.`
    );
  }

  return ip;
}
