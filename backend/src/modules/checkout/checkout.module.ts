import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CatalogModule } from '../catalog/catalog.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { QuoteService } from './quote.service';
import { CheckoutService } from './checkout.service';
import { CheckoutController } from './checkout.controller';
import { HardwareOrdersService } from './hardware-orders.service';
import { HardwareOrdersController } from './hardware-orders.controller';
import { CheckoutIntentService } from './checkout-intent.service';
import { CheckoutSettlementService } from './checkout-settlement.service';

@Module({
  imports: [PrismaModule, CatalogModule, MarketplaceModule],
  controllers: [CheckoutController, HardwareOrdersController],
  providers: [
    QuoteService,
    CheckoutService,
    HardwareOrdersService,
    // v2.8.85: mixed-cart PayTR flow.
    CheckoutIntentService,
    CheckoutSettlementService,
  ],
  exports: [
    QuoteService,
    CheckoutService,
    HardwareOrdersService,
    CheckoutIntentService,
    // Exported so PaymentsModule's PaytrWebhookController can dispatch
    // CK- prefix callbacks here.
    CheckoutSettlementService,
  ],
})
export class CheckoutModule {}
