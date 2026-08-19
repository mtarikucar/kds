jest.mock("axios");
import axios from "axios";
// A bare `jest.mock(path)` automock replaces UnsafeUrlError's constructor
// with a no-op, so `new UnsafeUrlError("msg").message` comes back undefined
// and `e instanceof UnsafeUrlError` is the only thing that still works.
// Give it a real Error subclass instead, matching
// webhook-delivery-worker.service.spec.ts's mock of the same module.
jest.mock("../../../common/net/url-safety", () => ({
  assertPublicHttpUrl: jest.fn(),
  UnsafeUrlError: class UnsafeUrlError extends Error {},
}));
import { assertPublicHttpUrl, UnsafeUrlError } from "../../../common/net/url-safety";
import { BadRequestException } from "@nestjs/common";
import { MenuSourceFetcher } from "./menu-source-fetcher.service";

describe("MenuSourceFetcher", () => {
  let svc: MenuSourceFetcher;
  const config = { get: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new MenuSourceFetcher(config as any);
    (assertPublicHttpUrl as jest.Mock).mockImplementation(async (u: string) => ({
      url: new URL(u),
      resolvedIp: "93.184.216.34",
    }));
  });

  it("validates the URL twice — once on entry, once before the socket", async () => {
    (axios.get as jest.Mock).mockResolvedValue({
      status: 200,
      data: Buffer.from("<html>ok</html>"),
      headers: { "content-type": "text/html" },
      request: { res: { responseUrl: "https://x.test/menu" } },
    });
    await svc.fetch("https://x.test/menu");
    expect((assertPublicHttpUrl as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("turns an unsafe URL into a 400 carrying the guard's message", async () => {
    (assertPublicHttpUrl as jest.Mock).mockRejectedValue(
      new UnsafeUrlError("URL resolves to a private address"),
    );
    await expect(svc.fetch("http://169.254.169.254/latest")).rejects.toThrow(
      BadRequestException,
    );
    await expect(svc.fetch("http://169.254.169.254/latest")).rejects.toThrow(
      /private address/,
    );
  });

  it("re-validates every redirect hop", async () => {
    (axios.get as jest.Mock).mockResolvedValue({
      status: 200,
      data: Buffer.from("x"),
      headers: {},
      request: { res: { responseUrl: "https://evil.test/final" } },
    });
    await svc.fetch("https://x.test/start");
    const checked = (assertPublicHttpUrl as jest.Mock).mock.calls.map((c) => c[0]);
    expect(checked).toContain("https://evil.test/final");
  });

  it("rejects a body over the cap", async () => {
    (axios.get as jest.Mock).mockResolvedValue({
      status: 200,
      data: Buffer.alloc(11 * 1024 * 1024),
      headers: {},
      request: { res: { responseUrl: "https://x.test/big" } },
    });
    await expect(svc.fetch("https://x.test/big")).rejects.toThrow(/too large/i);
  });

  it("normalises a Google Sheets edit link to its CSV export", async () => {
    (axios.get as jest.Mock).mockResolvedValue({
      status: 200,
      data: Buffer.from("Ad,Fiyat\n"),
      headers: { "content-type": "text/csv" },
      request: { res: { responseUrl: "https://docs.google.com/x" } },
    });
    await svc.fetch("https://docs.google.com/spreadsheets/d/ABC123/edit#gid=0");
    expect((axios.get as jest.Mock).mock.calls[0][0]).toBe(
      "https://docs.google.com/spreadsheets/d/ABC123/export?format=csv",
    );
  });

  it("detects a private Sheet answering 200 with a Google login page", async () => {
    (axios.get as jest.Mock).mockResolvedValue({
      status: 200,
      data: Buffer.from("<html><head><title>Sign in - Google Accounts</title>"),
      headers: { "content-type": "text/html" },
      request: { res: { responseUrl: "https://accounts.google.com/signin" } },
    });
    await expect(
      svc.fetch("https://docs.google.com/spreadsheets/d/ABC/export?format=csv"),
    ).rejects.toThrow(/herkese açık|not publicly/i);
  });
});
