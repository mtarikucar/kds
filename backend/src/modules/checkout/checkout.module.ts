import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CatalogModule } from '../catalog/catalog.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { QuoteService } from './quote.service';
import { CheckoutService } from './checkout.service';
import { CheckoutController } from './checkout.controller';
import { HardwareOrdersService } from './hardware-orders.service';
import { HardwareOrdersController } from './hardware-orders.controller';

@Module({
  imports: [PrismaModule, CatalogModule, MarketplaceModule],
  controllers: [CheckoutController, HardwareOrdersController],
  providers: [QuoteService, CheckoutService, HardwareOrdersService],
  exports: [QuoteService, CheckoutService, HardwareOrdersService],
})
export class CheckoutModule {}
