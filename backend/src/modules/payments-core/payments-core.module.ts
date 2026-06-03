import { Global, Module } from "@nestjs/common";
import { PaymentProviderRegistry } from "./payment-provider.registry";
import { PaymentsFacadeService } from "./payments-facade.service";
import { MockPaymentProvider } from "./adapters/mock-payment-provider";
import { PaytrPaymentProvider } from "./adapters/paytr-payment-provider";
import { PaytrAdapterModule } from "../payments/adapters/paytr-adapter.module";

/**
 * Payments-core module. Exposes the provider-neutral interface that the
 * marketplace / hardware checkout / future POS terminal services consume.
 *
 * Marked @Global so adapters declared in their own modules (PayTR adapter
 * already exists at modules/payments/adapters/paytr-adapter.module.ts) can
 * inject PaymentProviderRegistry and register themselves at module init.
 *
 * NOTE: this module deliberately does not replace the existing PayTR /
 * subscription billing path. It coexists and offers a uniform surface for
 * new providers and the upcoming card-present terminal work.
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
