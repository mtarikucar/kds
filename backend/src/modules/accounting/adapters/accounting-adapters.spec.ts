import { ParasutAdapter } from "./parasut.adapter";
import { LogoAdapter } from "./logo.adapter";
import { ForibaEfaturaAdapter } from "./foriba-efatura.adapter";
import { AccountingInvoiceData } from "./accounting-adapter.interface";

/**
 * Long-tail spec for the accounting provider adapters (the real impls
 * behind the AccountingAdapter seam, driven against a fake httpClient).
 * Load-bearing contracts shared by all three: authenticate maps the token
 * + expiry off the provider response; testConnection is true on success,
 * false on any auth error (so a bad-credential probe never throws into the
 * settings UI); pushInvoice returns a non-empty externalId.
 */
const invoice: AccountingInvoiceData = {
  invoiceNumber: "FTR-1001",
  issueDate: "2026-06-15",
  currency: "TRY",
  totalAmount: 120,
  items: [
    { description: "Coffee", quantity: 2, unitPrice: 50, taxRate: 20 },
  ],
};

function fakeHttp() {
  return {
    post: jest.fn(),
    get: jest.fn(),
    defaults: { baseURL: "" } as { baseURL?: string },
  };
}

describe("ParasutAdapter", () => {
  it("authenticate maps access_token + computes expiry", async () => {
    const adapter = new ParasutAdapter();
    const http = fakeHttp();
    http.post.mockResolvedValue({
      data: { access_token: "tok", expires_in: 100 },
    });
    (adapter as any).httpClient = http;
    const out = await adapter.authenticate({});
    expect(out.accessToken).toBe("tok");
    expect(out.expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("testConnection returns false on auth failure (no throw into UI)", async () => {
    const adapter = new ParasutAdapter();
    const http = fakeHttp();
    http.post.mockRejectedValue(new Error("401"));
    (adapter as any).httpClient = http;
    await expect(adapter.testConnection({})).resolves.toBe(false);
  });

  it("pushInvoice returns the created sales-invoice externalId", async () => {
    const adapter = new ParasutAdapter();
    const http = fakeHttp();
    // contact search (none) → create invoice → details
    http.get.mockResolvedValue({ data: { data: [] } });
    http.post
      .mockResolvedValueOnce({ data: { data: { id: "contact-1" } } }) // create contact
      .mockResolvedValueOnce({ data: { data: { id: "si-9" } } }) // create invoice
      .mockResolvedValue({ data: {} }); // line items
    (adapter as any).httpClient = http;
    const out = await adapter.pushInvoice("tok", "co-1", {
      ...invoice,
      customerName: "Acme",
    });
    expect(out.externalId).toBe("si-9");
  });
});

describe("LogoAdapter", () => {
  it("authenticate prefers data.token and sets a 1h expiry", async () => {
    const adapter = new LogoAdapter();
    const http = fakeHttp();
    http.post.mockResolvedValue({ data: { token: "logo-tok" } });
    (adapter as any).httpClient = http;
    const out = await adapter.authenticate({ apiUrl: "https://logo.example" });
    expect(out.accessToken).toBe("logo-tok");
    expect(out.expiresAt).toBeInstanceOf(Date);
  });

  it("pushInvoice maps the INTERNAL_REFERENCE to externalId", async () => {
    const adapter = new LogoAdapter();
    const http = fakeHttp();
    http.post.mockResolvedValue({ data: { INTERNAL_REFERENCE: 4242 } });
    (adapter as any).httpClient = http;
    const out = await adapter.pushInvoice("tok", "co-1", invoice);
    expect(out.externalId).toBe("4242");
  });

  it("testConnection returns true when authenticate succeeds", async () => {
    const adapter = new LogoAdapter();
    const http = fakeHttp();
    http.post.mockResolvedValue({ data: { token: "t" } });
    (adapter as any).httpClient = http;
    await expect(
      adapter.testConnection({ apiUrl: "x", username: "u", password: "p" }),
    ).resolves.toBe(true);
  });
});

describe("ForibaEfaturaAdapter", () => {
  it("authenticate maps access_token off the OAuth response", async () => {
    const adapter = new ForibaEfaturaAdapter();
    const http = fakeHttp();
    http.post.mockResolvedValue({
      data: { access_token: "fb-tok", expires_in: 200 },
    });
    (adapter as any).httpClient = http;
    const out = await adapter.authenticate({
      apiUrl: "https://foriba.example",
      username: "u",
      password: "p",
    });
    expect(out.accessToken).toBe("fb-tok");
  });

  it("pushInvoice base64-encodes UBL and returns the uuid externalId", async () => {
    const adapter = new ForibaEfaturaAdapter();
    const http = fakeHttp();
    http.post.mockResolvedValue({ data: { uuid: "fb-uuid-1" } });
    (adapter as any).httpClient = http;
    const out = await adapter.pushInvoice("tok", "co-1", invoice);
    expect(out.externalId).toBe("fb-uuid-1");
    // the dispatch body carries base64 content
    const body = http.post.mock.calls[0][1];
    expect(typeof body.content).toBe("string");
    expect(Buffer.from(body.content, "base64").toString()).toContain("Invoice");
  });

  it("testConnection returns false when authenticate throws", async () => {
    const adapter = new ForibaEfaturaAdapter();
    const http = fakeHttp();
    http.post.mockRejectedValue(new Error("bad creds"));
    (adapter as any).httpClient = http;
    await expect(adapter.testConnection({})).resolves.toBe(false);
  });
});
