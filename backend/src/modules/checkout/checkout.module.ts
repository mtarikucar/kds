import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CatalogModule } from '../catalog/catalog.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { QuoteService } from './quote.service';
import { CheckoutService } from './checkout.service';
import { CheckoutController } from './checkout.controller';

@Module({
  imports: [PrismaModule, CatalogModule, MarketplaceModule],
  controllers: [CheckoutController],
  providers: [QuoteService, CheckoutService],
  exports: [QuoteService, CheckoutService],
})
export class CheckoutModule {}
