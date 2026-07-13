import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { TaxCalculationService } from "./services/tax-calculation.service";
import { AccountingSettingsService } from "./services/accounting-settings.service";
import { SalesInvoiceService } from "./services/sales-invoice.service";
import { AccountingSyncService } from "./services/accounting-sync.service";
import { AccountingSettingsController } from "./controllers/accounting-settings.controller";
import { SalesInvoiceController } from "./controllers/sales-invoice.controller";
import { EDocumentController } from "./controllers/e-document.controller";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
import {
  MUKELLEF_QUERY,
  MockMukellefQueryProvider,
  NullMukellefQueryProvider,
} from "./providers/mukellef-query.provider";
import {
  E_DOCUMENT_SIGNER,
  MockEDocumentSigner,
  NullEDocumentSigner,
} from "./providers/e-document-signer";
import { AccountingResyncScheduler } from "./schedulers/accounting-resync.scheduler";

/** Fail fast if the mock e-belge providers are about to boot in production. */
function assertMockAllowed(): void {
  if (
    process.env.EBELGE_PROVIDER === "mock" &&
    process.env.NODE_ENV === "production"
  ) {
    throw new Error(
      "EBELGE_PROVIDER=mock is not allowed in production — mock mükellef/signer providers would corrupt real e-belge dispatches",
    );
  }
}

@Module({
  imports: [PrismaModule, SubscriptionsModule],
  controllers: [
    AccountingSettingsController,
    SalesInvoiceController,
    EDocumentController,
  ],
  providers: [
    TaxCalculationService,
    AccountingSettingsService,
    SalesInvoiceService,
    AccountingSyncService,
    AccountingResyncScheduler,
    // e-Belge external-integration providers. EBELGE_PROVIDER=mock enables the
    // in-memory mükellef query + signer for the full flow; otherwise the Null
    // providers keep issuance safe (route to e-Arşiv, refuse to sign) until the
    // real integrator creds + certificate are installed under these tokens.
    // The mock binding is REFUSED in production: a lingering EBELGE_PROVIDER=mock
    // env var would fake mükellef answers and inject mock signatures into real
    // integrator dispatches.
    {
      provide: MUKELLEF_QUERY,
      useFactory: () => {
        assertMockAllowed();
        return process.env.EBELGE_PROVIDER === "mock"
          ? new MockMukellefQueryProvider()
          : new NullMukellefQueryProvider();
      },
    },
    {
      provide: E_DOCUMENT_SIGNER,
      useFactory: () => {
        assertMockAllowed();
        return process.env.EBELGE_PROVIDER === "mock"
          ? new MockEDocumentSigner()
          : new NullEDocumentSigner();
      },
    },
  ],
  exports: [
    TaxCalculationService,
    AccountingSettingsService,
    SalesInvoiceService,
    AccountingSyncService,
  ],
})
export class AccountingModule {}
