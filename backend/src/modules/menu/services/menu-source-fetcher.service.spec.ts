jest.mock("axios");
import axios from "axios";
import * as https from "node:https";
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

  it("guards a hop before requesting it, and pins the connection to the resolved IP", async () => {
    (axios.get as jest.Mock).mockResolvedValue({
      status: 200,
      data: Buffer.from("<html>ok</html>"),
      headers: { "content-type": "text/html" },
    });

    await svc.fetch("https://x.test/menu");

    expect(assertPublicHttpUrl).toHaveBeenCalledWith("https://x.test/menu");
    const opts = (axios.get as jest.Mock).mock.calls[0][1];
    expect(opts.maxRedirects).toBe(0); // we walk hops ourselves, not axios
    expect(opts.httpsAgent).toBeInstanceOf(https.Agent);
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

  it("refuses a redirect to a private address, and never requests it", async () => {
    (assertPublicHttpUrl as jest.Mock).mockImplementation(async (u: string) => {
      if (u.includes("internal-host")) {
        throw new UnsafeUrlError("URL resolves to a private address");
      }
      return { url: new URL(u), resolvedIp: "93.184.216.34" };
    });
    (axios.get as jest.Mock).mockResolvedValueOnce({
      status: 302,
      data: Buffer.alloc(0),
      headers: { location: "http://internal-host/secret" },
    });

    await expect(svc.fetch("https://x.test/start")).rejects.toThrow(/private address/);
    // The private hop was guarded and rejected BEFORE being requested.
    expect((axios.get as jest.Mock).mock.calls.length).toBe(1);
  });

  it("walks a chain of redirects, guarding and requesting every hop in order", async () => {
    (axios.get as jest.Mock)
      .mockResolvedValueOnce({
        status: 302,
        data: Buffer.alloc(0),
        headers: { location: "https://mid.test/step2" },
      })
      .mockResolvedValueOnce({
        status: 302,
        data: Buffer.alloc(0),
        headers: { location: "https://x.test/final" },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: Buffer.from("ok"),
        headers: { "content-type": "text/plain" },
      });

    const result = await svc.fetch("https://x.test/start");

    expect(result.finalUrl).toBe("https://x.test/final");
    const guardedUrls = (assertPublicHttpUrl as jest.Mock).mock.calls.map((c) => c[0]);
    expect(guardedUrls).toEqual([
      "https://x.test/start",
      "https://mid.test/step2",
      "https://x.test/final",
    ]);
    expect((axios.get as jest.Mock).mock.calls.map((c) => c[0])).toEqual(guardedUrls);
  });

  it("stops walking once MENU_SOURCE_MAX_REDIRECTS is exceeded", async () => {
    config.get.mockImplementation((key: string) =>
      key === "MENU_SOURCE_MAX_REDIRECTS" ? "1" : undefined,
    );
    svc = new MenuSourceFetcher(config as any);
    (axios.get as jest.Mock)
      .mockResolvedValueOnce({
        status: 302,
        data: Buffer.alloc(0),
        headers: { location: "https://x.test/hop2" },
      })
      .mockResolvedValueOnce({
        status: 302,
        data: Buffer.alloc(0),
        headers: { location: "https://x.test/hop3" },
      });

    await expect(svc.fetch("https://x.test/start")).rejects.toThrow(/redirect/i);
  });

  it("rejects a body over the cap (post-hoc byte-length check)", async () => {
    (axios.get as jest.Mock).mockResolvedValue({
      status: 200,
      data: Buffer.alloc(11 * 1024 * 1024),
      headers: {},
    });
    await expect(svc.fetch("https://x.test/big")).rejects.toThrow(/too large/i);
  });

  it("rejects when axios itself reports the body exceeded maxContentLength", async () => {
    const err: any = new Error("maxContentLength size of 10485760 exceeded");
    err.code = "ERR_BAD_RESPONSE";
    (axios.get as jest.Mock).mockRejectedValue(err);
    await expect(svc.fetch("https://x.test/big")).rejects.toThrow(/too large/i);
  });

  it("passes the configured ceilings through to axios, using the documented defaults", async () => {
    (axios.get as jest.Mock).mockResolvedValue({
      status: 200,
      data: Buffer.from("ok"),
      headers: {},
    });
    await svc.fetch("https://x.test/menu");
    const opts = (axios.get as jest.Mock).mock.calls[0][1];
    expect(opts.timeout).toBe(15_000);
    expect(opts.maxContentLength).toBe(10 * 1024 * 1024);
    expect(opts.maxBodyLength).toBe(10 * 1024 * 1024);
  });

  it("honours numericEnv overrides for the ceilings", async () => {
    config.get.mockImplementation(
      (key: string) =>
        ({
          MENU_SOURCE_TIMEOUT_MS: "5000",
          MENU_SOURCE_MAX_BYTES: "2048",
        })[key],
    );
    svc = new MenuSourceFetcher(config as any);
    (axios.get as jest.Mock).mockResolvedValue({
      status: 200,
      data: Buffer.from("ok"),
      headers: {},
    });
    await svc.fetch("https://x.test/menu");
    const opts = (axios.get as jest.Mock).mock.calls[0][1];
    expect(opts.timeout).toBe(5000);
    expect(opts.maxContentLength).toBe(2048);
    expect(opts.maxBodyLength).toBe(2048);
  });

  it("normalises a Google Sheets edit link to its CSV export, carrying the tab from the fragment", async () => {
    (axios.get as jest.Mock).mockResolvedValue({
      status: 200,
      data: Buffer.from("Ad,Fiyat\n"),
      headers: { "content-type": "text/csv" },
    });
    await svc.fetch("https://docs.google.com/spreadsheets/d/ABC123/edit#gid=847362");
    expect((axios.get as jest.Mock).mock.calls[0][0]).toBe(
      "https://docs.google.com/spreadsheets/d/ABC123/export?format=csv&gid=847362",
    );
  });

  it("carries a gid supplied as a query parameter into the export URL", async () => {
    (axios.get as jest.Mock).mockResolvedValue({
      status: 200,
      data: Buffer.from("Ad,Fiyat\n"),
      headers: { "content-type": "text/csv" },
    });
    await svc.fetch("https://docs.google.com/spreadsheets/d/ABC123/edit?gid=42");
    expect((axios.get as jest.Mock).mock.calls[0][0]).toBe(
      "https://docs.google.com/spreadsheets/d/ABC123/export?format=csv&gid=42",
    );
  });

  it("accepts the /u/<n> multi-account segment on a share link", async () => {
    (axios.get as jest.Mock).mockResolvedValue({
      status: 200,
      data: Buffer.from("Ad,Fiyat\n"),
      headers: { "content-type": "text/csv" },
    });
    await svc.fetch("https://docs.google.com/spreadsheets/u/0/d/ABC123/edit");
    expect((axios.get as jest.Mock).mock.calls[0][0]).toBe(
      "https://docs.google.com/spreadsheets/d/ABC123/export?format=csv",
    );
  });

  it("leaves a publish-to-web link alone — it already serves the export directly", async () => {
    (axios.get as jest.Mock).mockResolvedValue({
      status: 200,
      data: Buffer.from("Ad,Fiyat\n"),
      headers: { "content-type": "text/csv" },
    });
    const pubUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQabc/pub?output=csv";
    await svc.fetch(pubUrl);
    expect((axios.get as jest.Mock).mock.calls[0][0]).toBe(pubUrl);
  });

  it("detects a private Sheet answering 200 with a Google login page", async () => {
    (axios.get as jest.Mock).mockResolvedValue({
      status: 200,
      data: Buffer.from("<html><head><title>Sign in - Google Accounts</title>"),
      headers: { "content-type": "text/html" },
    });
    await expect(
      svc.fetch("https://docs.google.com/spreadsheets/d/ABC/export?format=csv"),
    ).rejects.toThrow(/herkese açık|not publicly/i);
  });

  it("catches a private Sheet reached via a redirect, keying the check on the final URL", async () => {
    (axios.get as jest.Mock)
      .mockResolvedValueOnce({
        status: 302,
        data: Buffer.alloc(0),
        headers: {
          location: "https://docs.google.com/spreadsheets/d/ABC/export?format=csv",
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: Buffer.from("<html><head><title>Sign in - Google Accounts</title>"),
        headers: { "content-type": "text/html" },
      });
    // The requested URL is a link shortener — NOT a docs.google.com URL —
    // so a check keyed on the requested URL would miss this entirely.
    await expect(svc.fetch("https://short.link/xyz")).rejects.toThrow(
      /herkese açık|not publicly/i,
    );
  });
});
