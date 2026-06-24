import { Global, Module } from "@nestjs/common";
import { PaymentProviderRegistry } from "./payment-provider.registry";
import { PaymentsFacadeService } from "./payments-facade.service";
import { MockPaymentProvider } from "./adapters/mock-payment-provider";
import { PaytrPaymentProvider } from "./adapters/paytr-payment-provider";
import { PaytrAdapterModule } from "../payments/adapters/paytr-adapter.module";

/**
 * Payments-core module. Exposes the provider-neutral interface that the
 * mixed-cart checkout rail (CheckoutIntentService → createIntent("paytr"))
 * consumes.
 *
 * Marked @Global so adapters declared in their own modules (PayTR adapter
 * already exists at modules/payments/adapters/paytr-adapter.module.ts) can
 * inject PaymentProviderRegistry and register themselves at module init.
 *
 * NOTE: this module deliberately does not replace the existing PayTR /
 * subscription billing path. It coexists and offers a uniform surface so a
 * future provider can be added without touching the caller. The Iyzico /
 * Ingenico adapters were removed (2026-06-24): they self-registered but were
 * never dispatched (only "paytr" is ever requested), and the DeviceMeshModule
 * import existed solely to feed the Ingenico card-present terminal — both gone.
 */
@Global()
@Module({
  imports: [PaytrAdapterModule],
  providers: [
    PaymentProviderRegistry,
    PaymentsFacadeService,
    MockPaymentProvider,
    PaytrPaymentProvider,
  ],
  exports: [PaymentProviderRegistry, PaymentsFacadeService],
})
export class PaymentsCoreModule {}
