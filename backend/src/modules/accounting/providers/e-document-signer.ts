import { Injectable, ServiceUnavailableException } from "@nestjs/common";

export const E_DOCUMENT_SIGNER = Symbol("E_DOCUMENT_SIGNER");

/**
 * e-Belge XAdES signer. A real implementation signs the UBL-TR document with the
 * tenant's mali mühür / e-imza certificate (a runtime secret + HSM/soft-cert) —
 * external. The signing STEP in the dispatch pipeline is code-complete and
 * tested via the mock signer; going live is swapping in the cert-backed signer
 * under the E_DOCUMENT_SIGNER token.
 */
export interface EDocumentSigner {
  readonly name: string;
  isConfigured(): boolean;
  /** Return the signed UBL. Throws if signing is not configured. */
  sign(xml: string): Promise<string>;
}

/** Deterministic placeholder signature so the pipeline produces a "signed"
 * artifact end-to-end. NOT a valid XAdES signature — a stand-in for the flow. */
@Injectable()
export class MockEDocumentSigner implements EDocumentSigner {
  readonly name = "MOCK";

  isConfigured(): boolean {
    return true;
  }

  async sign(xml: string): Promise<string> {
    if (xml.includes("</Invoice>")) {
      // Namespace declared inline so even a misrouted mock-signed dispatch is
      // namespace-VALID XML — it fails at the provider for a debuggable
      // reason (unknown element) instead of as an XML parse error.
      return xml.replace(
        "</Invoice>",
        '  <ext:MockSignature xmlns:ext="urn:hummytummy:mock-signature">SIGNED</ext:MockSignature>\n</Invoice>',
      );
    }
    return `${xml}\n<!-- MockSignature: SIGNED -->`;
  }
}

/** Default when no certificate is configured — refuses to sign (clear signal). */
@Injectable()
export class NullEDocumentSigner implements EDocumentSigner {
  readonly name = "NONE";

  isConfigured(): boolean {
    return false;
  }

  async sign(): Promise<string> {
    throw new ServiceUnavailableException(
      "No e-signature certificate configured (mali mühür / e-imza). Install a cert-backed signer to issue e-documents.",
    );
  }
}
