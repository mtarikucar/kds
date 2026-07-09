import {
  MockMukellefQueryProvider,
  NullMukellefQueryProvider,
} from "./mukellef-query.provider";
import {
  MockEDocumentSigner,
  NullEDocumentSigner,
} from "./e-document-signer";

describe("MukellefQueryProvider", () => {
  it("mock: 10-digit VKN is a registered e-Fatura user, 11-digit TCKN is not", async () => {
    const p = new MockMukellefQueryProvider();
    expect(await p.isRegisteredEFaturaUser("1234567890")).toBe(true);
    expect(await p.isRegisteredEFaturaUser("12345678901")).toBe(false);
    expect(await p.isRegisteredEFaturaUser("")).toBe(false);
  });

  it("null: nobody is registered (routes everything to e-Arşiv)", async () => {
    const p = new NullMukellefQueryProvider();
    expect(await p.isRegisteredEFaturaUser("1234567890")).toBe(false);
  });
});

describe("EDocumentSigner", () => {
  it("mock: injects a signature marker into the UBL", async () => {
    const s = new MockEDocumentSigner();
    expect(s.isConfigured()).toBe(true);
    const signed = await s.sign("<Invoice><cbc:ID>1</cbc:ID></Invoice>");
    expect(signed).toContain("MockSignature");
    expect(signed).toContain("</Invoice>");
  });

  it("null: refuses to sign when no certificate is configured", async () => {
    const s = new NullEDocumentSigner();
    expect(s.isConfigured()).toBe(false);
    await expect(s.sign("<Invoice/>")).rejects.toThrow(/certificate/i);
  });
});
