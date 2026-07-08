import { Injectable } from "@nestjs/common";

export const MUKELLEF_QUERY = Symbol("MUKELLEF_QUERY");

/**
 * GİB e-Fatura mükellef (registered-user) query. A real implementation hits the
 * integrator's mükellef-sorgu endpoint (needs integrator credentials) to decide
 * whether a buyer is a registered e-Fatura user (→ e-Fatura) or not (→ e-Arşiv).
 * The routing code path is complete and tested against the mock; production =
 * swapping in the HTTP-backed provider under the MUKELLEF_QUERY token.
 */
export interface MukellefQueryProvider {
  readonly name: string;
  isRegisteredEFaturaUser(taxId: string): Promise<boolean>;
}

/**
 * Deterministic stand-in: treats a 10-digit VKN (a company) as a registered
 * e-Fatura user and an 11-digit TCKN (an individual) as not — a plausible
 * approximation of the GİB check for dev/test and the full routing flow.
 */
@Injectable()
export class MockMukellefQueryProvider implements MukellefQueryProvider {
  readonly name = "MOCK";

  async isRegisteredEFaturaUser(taxId: string): Promise<boolean> {
    return /^\d{10}$/.test((taxId ?? "").trim());
  }
}

/** Default when no integrator is configured — nobody is registered, so every
 * invoice routes to e-Arşiv (the safe B2C path). */
@Injectable()
export class NullMukellefQueryProvider implements MukellefQueryProvider {
  readonly name = "NONE";

  async isRegisteredEFaturaUser(): Promise<boolean> {
    return false;
  }
}
