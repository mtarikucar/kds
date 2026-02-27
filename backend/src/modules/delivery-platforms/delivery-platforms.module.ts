import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { KdsModule } from '../kds/kds.module';

// Adapters
import { GetirAdapter } from './adapters/getir.adapter';
import { YemeksepetiAdapter } from './adapters/yemeksepeti.adapter';
import { TrendyolAdapter } from './adapters/trendyol.adapter';
import { MigrosAdapter } from './adapters/migros.adapter';
import { AdapterFactory } from './adapters/adapter-factory';

// Services
import { DeliveryOrderService } from './services/delivery-order.service';
import { DeliveryStatusSyncService } from './services/delivery-status-sync.service';
import { DeliveryAuthService } from './services/delivery-auth.service';
import { DeliveryMenuSyncService } from './services/delivery-menu-sync.service';
import { DeliveryConfigService } from './services/delivery-config.service';
import { DeliveryLogService } from './services/delivery-log.service';

// Controllers
import { DeliveryPlatformsController } from './controllers/delivery-platforms.controller';
import { DeliveryWebhookController } from './controllers/delivery-webhook.controller';

// Schedulers
import { OrderPollingScheduler } from './schedulers/order-polling.scheduler';
import { TokenRefreshScheduler } from './schedulers/token-refresh.scheduler';
import { RetryScheduler } from './schedulers/retry.scheduler';

// Guards
import { WebhookAuthGuard } from './guards/webhook-auth.guard';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    ScheduleModule.forRoot(),
    forwardRef(() => KdsModule),
  ],
  controllers: [DeliveryPlatformsController, DeliveryWebhookController],
  providers: [
    // Adapters
    GetirAdapter,
    YemeksepetiAdapter,
    TrendyolAdapter,
    MigrosAdapter,
    AdapterFactory,

    // Services
    DeliveryOrderService,
    DeliveryStatusSyncService,
    DeliveryAuthService,
    DeliveryMenuSyncService,
    DeliveryConfigService,
    DeliveryLogService,

    // Schedulers
    OrderPollingScheduler,
    TokenRefreshScheduler,
    RetryScheduler,

    // Guards
    WebhookAuthGuard,
  ],
  exports: [
    DeliveryStatusSyncService,
    DeliveryOrderService,
    DeliveryConfigService,
  ],
})
export class DeliveryPlatformsModule {}
