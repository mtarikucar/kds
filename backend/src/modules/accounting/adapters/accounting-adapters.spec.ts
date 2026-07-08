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

  it("pushInvoice THROWS when the response has no INTERNAL_REFERENCE (no fake id)", async () => {
    const adapter = new LogoAdapter();
    const http = fakeHttp();
    http.post.mockResolvedValue({ data: {} });
    (adapter as any).httpClient = http;
    await expect(adapter.pushInvoice("tok", "co-1", invoice)).rejects.toThrow(
      /no INTERNAL_REFERENCE/i,
    );
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

  it("emits cac:AccountingSupplierParty with the configured seller VKN + name (fake-working sweep #3)", async () => {
    const adapter = new ForibaEfaturaAdapter();
    const http = fakeHttp();
    http.post.mockResolvedValue({ data: { uuid: "fb-uuid-2" } });
    (adapter as any).httpClient = http;
    await adapter.pushInvoice("tok", "co-1", {
      ...invoice,
      sellerName: "Lezzet Lokantası A.Ş.",
      sellerTaxId: "1234567890",
      sellerTaxOffice: "Kadıköy",
      sellerAddress: "Bağdat Cad. No:1",
      sellerPhone: "+902161234567",
      sellerEmail: "fatura@lezzet.example",
    });
    const xml = Buffer.from(
      http.post.mock.calls[0][1].content,
      "base64",
    ).toString();
    expect(xml).toContain("<cac:AccountingSupplierParty>");
    expect(xml).toContain("Lezzet Lokantası A.Ş."); // name present (no XML-special chars)
    expect(xml).toContain("<cbc:CompanyID>1234567890</cbc:CompanyID>"); // VKN
    expect(xml).toContain("Kadıköy"); // tax office
    expect(xml).toContain("Bağdat Cad. No:1"); // address
    expect(xml).toContain("+902161234567"); // phone
    expect(xml).toContain("fatura@lezzet.example"); // email
  });

  it("emits a minimal supplier party with a 'Satici' placeholder when no seller is configured", async () => {
    const adapter = new ForibaEfaturaAdapter();
    const http = fakeHttp();
    http.post.mockResolvedValue({ data: { uuid: "fb-uuid-3" } });
    (adapter as any).httpClient = http;
    await adapter.pushInvoice("tok", "co-1", invoice); // no seller* fields
    const xml = Buffer.from(
      http.post.mock.calls[0][1].content,
      "base64",
    ).toString();
    expect(xml).toContain("<cac:AccountingSupplierParty>");
    expect(xml).toContain("Satici");
    // no VKN configured -> no PartyTaxScheme block (no empty CompanyID tag).
    expect(xml).not.toContain("<cac:PartyTaxScheme>");
  });

  it("routes an e-Fatura buyer to the TICARIFATURA profile with a buyer VKN party", async () => {
    const adapter = new ForibaEfaturaAdapter();
    const http = fakeHttp();
    http.post.mockResolvedValue({ data: { uuid: "fb-uuid-4" } });
    (adapter as any).httpClient = http;
    await adapter.pushInvoice("tok", "co-1", {
      ...invoice,
      eDocumentType: "EFATURA",
      customerName: "Alıcı Ltd.",
      customerTaxId: "9876543210",
      customerTaxOffice: "Şişli",
    });
    const xml = Buffer.from(
      http.post.mock.calls[0][1].content,
      "base64",
    ).toString();
    expect(xml).toContain("<cbc:ProfileID>TICARIFATURA</cbc:ProfileID>");
    expect(xml).toContain("<cac:AccountingCustomerParty>");
    expect(xml).toContain("<cbc:CompanyID>9876543210</cbc:CompanyID>"); // buyer VKN
    expect(xml).toContain("Şişli"); // buyer tax office
  });

  it("defaults to the EARSIVFATURA profile for a final consumer", async () => {
    const adapter = new ForibaEfaturaAdapter();
    const http = fakeHttp();
    http.post.mockResolvedValue({ data: { uuid: "fb-uuid-5" } });
    (adapter as any).httpClient = http;
    await adapter.pushInvoice("tok", "co-1", invoice); // no eDocumentType
    const xml = Buffer.from(
      http.post.mock.calls[0][1].content,
      "base64",
    ).toString();
    expect(xml).toContain("<cbc:ProfileID>EARSIVFATURA</cbc:ProfileID>");
    expect(xml).toContain("<cac:AccountingCustomerParty>");
  });

  it("testConnection returns false when authenticate throws", async () => {
    const adapter = new ForibaEfaturaAdapter();
    const http = fakeHttp();
    http.post.mockRejectedValue(new Error("bad creds"));
    (adapter as any).httpClient = http;
    await expect(adapter.testConnection({})).resolves.toBe(false);
  });

  it("pushInvoice THROWS when the response has no uuid/id (no fake id)", async () => {
    const adapter = new ForibaEfaturaAdapter();
    const http = fakeHttp();
    http.post.mockResolvedValue({ data: {} });
    (adapter as any).httpClient = http;
    await expect(adapter.pushInvoice("tok", "co-1", invoice)).rejects.toThrow(
      /no invoice id/i,
    );
  });
});
