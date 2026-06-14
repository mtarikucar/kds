import { lookup } from "node:dns/promises";
import { assertPublicHttpUrl, UnsafeUrlError } from "./url-safety";

jest.mock("node:dns/promises", () => ({ lookup: jest.fn() }));

const mockLookup = lookup as unknown as jest.Mock;

/**
 * Long-tail SSRF-defence spec. assertPublicHttpUrl guards every place we
 * fetch a tenant-supplied URL. Load-bearing contracts: reject non-http(s),
 * reject userinfo, reject blocked internal ports, reject hosts resolving to
 * private/loopback/link-local IPs (incl. AWS IMDS 169.254.169.254 and
 * IPv4-mapped IPv6), accept a genuine public host, and never leak the raw
 * DNS error.
 */
describe("assertPublicHttpUrl", () => {
  beforeEach(() => mockLookup.mockReset());

  it("rejects a non-http(s) scheme", async () => {
    await expect(assertPublicHttpUrl("ftp://example.com")).rejects.toThrow(
      UnsafeUrlError,
    );
  });

  it("rejects a syntactically invalid URL", async () => {
    await expect(assertPublicHttpUrl("not a url")).rejects.toThrow(
      "invalid URL",
    );
  });

  it("rejects embedded userinfo (credential smuggling)", async () => {
    await expect(
      assertPublicHttpUrl("https://user:pass@example.com/"),
    ).rejects.toThrow("userinfo");
  });

  it("rejects an obviously-internal blocked port", async () => {
    // 6379 = Redis. IP literal so DNS isn't consulted.
    await expect(assertPublicHttpUrl("http://8.8.8.8:6379/")).rejects.toThrow(
      /port .* not allowed/,
    );
  });

  it("rejects an IP literal in a private range (no DNS lookup)", async () => {
    await expect(
      assertPublicHttpUrl("http://169.254.169.254/latest/meta-data/"),
    ).rejects.toThrow("private address");
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("rejects a host that resolves to a private IP", async () => {
    mockLookup.mockResolvedValue({ address: "10.0.0.5", family: 4 });
    await expect(
      assertPublicHttpUrl("https://evil.example.com/hook"),
    ).rejects.toThrow("private address");
  });

  it("rejects a host resolving to an IPv4-mapped IPv6 loopback (bypass attempt)", async () => {
    mockLookup.mockResolvedValue({ address: "::ffff:127.0.0.1", family: 6 });
    await expect(
      assertPublicHttpUrl("https://sneaky.example.com/"),
    ).rejects.toThrow("private address");
  });

  it("does not leak the underlying DNS error on resolution failure", async () => {
    mockLookup.mockRejectedValue(new Error("ENOTFOUND secret-resolver"));
    await expect(
      assertPublicHttpUrl("https://nope.example.com/"),
    ).rejects.toThrow("hostname did not resolve");
  });

  it("accepts a genuine public host and returns the resolved IP", async () => {
    mockLookup.mockResolvedValue({ address: "8.8.8.8", family: 4 });
    const { url, resolvedIp } = await assertPublicHttpUrl(
      "https://Public.Example.com/webhook",
    );
    expect(resolvedIp).toBe("8.8.8.8");
    // hostname is lowercased for deterministic storage
    expect(url.hostname).toBe("public.example.com");
  });
});
