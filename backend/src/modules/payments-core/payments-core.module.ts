import { Global, Module } from "@nestjs/common";
import { PaymentProviderRegistry } from "./payment-provider.registry";
import { PaymentsFacadeService } from "./payments-facade.service";
import { MockPaymentProvider } from "./adapters/mock-payment-provider";
import { PaytrPaymentProvider } from "./adapters/paytr-payment-provider";
import { IngenicoTerminalProvider } from "./adapters/ingenico-terminal-provider";
import { IyzicoPaymentProvider } from "./adapters/iyzico-payment-provider";
import { PaytrAdapterModule } from "../payments/adapters/paytr-adapter.module";
// Ingenico card-present terminal routes charge_card commands through the
// on-prem local bridge → CommandQueueService (exported by DeviceMeshModule).
import { DeviceMeshModule } from "../device-mesh/device-mesh.module";

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
  imports: [PaytrAdapterModule, DeviceMeshModule],
  providers: [
    PaymentProviderRegistry,
    PaymentsFacadeService,
    MockPaymentProvider,
    PaytrPaymentProvider,
    IngenicoTerminalProvider,
    IyzicoPaymentProvider,
  ],
  exports: [PaymentProviderRegistry, PaymentsFacadeService],
})
export class PaymentsCoreModule {}
