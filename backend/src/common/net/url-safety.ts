import { lookup } from "node:dns/promises";
import { isIP, isIPv4, isIPv6 } from "node:net";

/**
 * SSRF defence for tenant-supplied URLs.
 *
 * Outbound webhooks (and any other place we fetch a tenant-configured URL)
 * are a classic SSRF target — a tenant who registers
 * `http://169.254.169.254/latest/meta-data/iam/security-credentials/<role>`
 * can use our server as a proxy to AWS IMDS, Redis, Postgres, or arbitrary
 * internal services.
 *
 * `assertPublicHttpUrl` enforces:
 *   - protocol = http or https only
 *   - no userinfo (`https://user:pass@host/...`)
 *   - port not in the small set of obviously-internal-only services
 *   - hostname resolves (or is) a public IP — no private / loopback / link-
 *     local / CGNAT / multicast / IPv4-mapped-IPv6 of any of the above
 *
 * Note on DNS rebind: a malicious DNS server can return a public IP at
 * subscribe-time and a private IP at fetch-time. Callers should
 * `assertPublicHttpUrl(url)` again immediately before the network call;
 * full mitigation requires pinning the resolved IP into the connect-time
 * socket which is invasive enough we defer it.
 */

const BLOCKED_PORTS = new Set([
  22, // SSH
  23, // Telnet
  25, // SMTP
  110, // POP3
  143, // IMAP
  445, // SMB
  2049, // NFS
  3306, // MySQL
  3389, // RDP
  5432, // PostgreSQL
  5984, // CouchDB
  6379, // Redis
  8086, // InfluxDB
  9200, // Elasticsearch
  9300, // Elasticsearch cluster
  11211, // memcached
  27017, // MongoDB
]);

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)
  ) {
    return false;
  }
  const [a, b, c, d] = parts;
  // 0.0.0.0/8 — "this network"
  if (a === 0) return true;
  // 10.0.0.0/8 — RFC1918 private
  if (a === 10) return true;
  // 100.64.0.0/10 — CGNAT (RFC6598)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 127.0.0.0/8 — loopback
  if (a === 127) return true;
  // 169.254.0.0/16 — link-local incl AWS IMDS at 169.254.169.254
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 — RFC1918 private
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.0.0.0/24 — IETF special-purpose
  if (a === 192 && b === 0 && c === 0) return true;
  // 192.0.2.0/24 — TEST-NET-1
  if (a === 192 && b === 0 && c === 2) return true;
  // 192.168.0.0/16 — RFC1918 private
  if (a === 192 && b === 168) return true;
  // 198.18.0.0/15 — benchmark
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 198.51.100.0/24 — TEST-NET-2
  if (a === 198 && b === 51 && c === 100) return true;
  // 203.0.113.0/24 — TEST-NET-3
  if (a === 203 && b === 0 && c === 113) return true;
  // 224.0.0.0/4 — multicast
  if (a >= 224 && a <= 239) return true;
  // 240.0.0.0/4 — reserved (incl. 255.255.255.255)
  if (a >= 240) return true;
  // suppress unused warning — d is captured for completeness if ranges grow
  void d;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const n = ip.toLowerCase();
  if (n === "::1" || n === "::") return true; // loopback + unspecified
  if (n.startsWith("fc") || n.startsWith("fd")) return true; // ULA fc00::/7
  if (
    n.startsWith("fe80:") ||
    n.startsWith("fe9") ||
    n.startsWith("fea") ||
    n.startsWith("feb")
  ) {
    return true; // link-local fe80::/10
  }
  if (n.startsWith("ff")) return true; // multicast ff00::/8
  // IPv4-mapped IPv6 (::ffff:x.x.x.x) — recheck against IPv4 ranges so an
  // attacker can't dress 127.0.0.1 up as ::ffff:127.0.0.1 to bypass.
  const m = n.match(/^::ffff:([0-9.]+)$/);
  if (m && isIPv4(m[1])) return isPrivateIPv4(m[1]);
  return false;
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/**
 * Validate that `input` is a syntactically valid URL pointing at a public
 * http(s) endpoint. Throws `UnsafeUrlError` with a short message safe to
 * surface to API callers — never echo the DNS resolution result back since
 * that's itself an information leak.
 */
export async function assertPublicHttpUrl(
  input: string,
): Promise<{ url: URL; resolvedIp: string }> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UnsafeUrlError("invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("URL must be http or https");
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("URL must not include userinfo");
  }
  if (url.port && BLOCKED_PORTS.has(Number(url.port))) {
    throw new UnsafeUrlError(`port ${url.port} is not allowed`);
  }
  // Lowercase host for deterministic storage (foo.com == FOO.COM).
  url.hostname = url.hostname.toLowerCase();

  let resolvedIp: string;
  if (isIP(url.hostname)) {
    resolvedIp = url.hostname;
  } else {
    try {
      const r = await lookup(url.hostname);
      resolvedIp = r.address;
    } catch {
      // Don't echo the underlying DNS error — it can leak resolver detail.
      throw new UnsafeUrlError("hostname did not resolve");
    }
  }
  if (isIPv4(resolvedIp) && isPrivateIPv4(resolvedIp)) {
    throw new UnsafeUrlError("URL resolves to a private address");
  }
  if (isIPv6(resolvedIp) && isPrivateIPv6(resolvedIp)) {
    throw new UnsafeUrlError("URL resolves to a private address");
  }
  return { url, resolvedIp };
}
