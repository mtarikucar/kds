import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';

// Prisma
import { PrismaModule } from '../../prisma/prisma.module';

// Related modules
import { OrdersModule } from '../orders/orders.module';
import { KdsModule } from '../kds/kds.module';

// Services
import { OrderIntegrationService } from './services/order-integration.service';
import { PlatformProviderFactory } from './services/platform-provider.factory';

// Providers
import { TrendyolProvider } from './services/providers/trendyol.provider';
import { YemeksepetiProvider } from './services/providers/yemeksepeti.provider';
import { GetirProvider } from './services/providers/getir.provider';
import { MigrosProvider } from './services/providers/migros.provider';
import { FuudyProvider } from './services/providers/fuudy.provider';

// Controllers
import { OrderIntegrationController } from './controllers/order-integration.controller';
import { ProductMappingController } from './controllers/product-mapping.controller';
import { MenuSyncController } from './controllers/menu-sync.controller';

// Webhook Controllers
import { TrendyolWebhookController } from './webhooks/trendyol-webhook.controller';
import { YemeksepetiWebhookController } from './webhooks/yemeksepeti-webhook.controller';
import { GetirWebhookController } from './webhooks/getir-webhook.controller';
import { MigrosWebhookController } from './webhooks/migros-webhook.controller';
import { FuudyWebhookController } from './webhooks/fuudy-webhook.controller';

@Module({
  imports: [
    PrismaModule,
    HttpModule.register({
      timeout: 30000,
      maxRedirects: 5,
    }),
    ConfigModule,
    forwardRef(() => OrdersModule),
    forwardRef(() => KdsModule),
  ],
  controllers: [
    // Admin API Controllers
    OrderIntegrationController,
    ProductMappingController,
    MenuSyncController,

    // Webhook Controllers (public)
    TrendyolWebhookController,
    YemeksepetiWebhookController,
    GetirWebhookController,
    MigrosWebhookController,
    FuudyWebhookController,
  ],
  providers: [
    // Core services
    OrderIntegrationService,
    PlatformProviderFactory,

    // Platform providers
    TrendyolProvider,
    YemeksepetiProvider,
    GetirProvider,
    MigrosProvider,
    FuudyProvider,
  ],
  exports: [
    OrderIntegrationService,
    PlatformProviderFactory,
    TrendyolProvider,
    YemeksepetiProvider,
    GetirProvider,
    MigrosProvider,
    FuudyProvider,
  ],
})
export class OrderIntegrationsModule {}
