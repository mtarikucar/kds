import { Module, forwardRef } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "../../prisma/prisma.module";
import { KdsModule } from "../kds/kds.module";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
// DeviceMeshModule provides CommandQueueService + EscPosBuilderService so
// DeliveryOrderService can auto-print kitchen tickets for incoming delivery
// orders via the SAME device-mesh print rail POS orders use. No cycle:
// DeviceMeshModule imports only Prisma/LocalBridge/Subscriptions.
import { DeviceMeshModule } from "../device-mesh/device-mesh.module";

// Adapters
import { GetirAdapter } from "./adapters/getir.adapter";
import { YemeksepetiAdapter } from "./adapters/yemeksepeti.adapter";
import { TrendyolAdapter } from "./adapters/trendyol.adapter";
import { MigrosAdapter } from "./adapters/migros.adapter";
import { AdapterFactory } from "./adapters/adapter-factory";

// Services
import { DeliveryOrderService } from "./services/delivery-order.service";
import { DeliveryStatusSyncService } from "./services/delivery-status-sync.service";
import { DeliveryAuthService } from "./services/delivery-auth.service";
import { DeliveryMenuSyncService } from "./services/delivery-menu-sync.service";
import { DeliveryConfigService } from "./services/delivery-config.service";
import { DeliveryLogService } from "./services/delivery-log.service";
import { DeliveryTestService } from "./services/delivery-test.service";
import { DeliveryModerationService } from "./services/delivery-moderation.service";
import { DeliveryReconciliationService } from "./services/delivery-reconciliation.service";

// Controllers
import { DeliveryPlatformsController } from "./controllers/delivery-platforms.controller";
import { DeliveryWebhookController } from "./controllers/delivery-webhook.controller";
import { DeliveryDlqController } from "./controllers/delivery-dlq.controller";

// Schedulers
import { OrderPollingScheduler } from "./schedulers/order-polling.scheduler";
import { TokenRefreshScheduler } from "./schedulers/token-refresh.scheduler";
import { RetryScheduler } from "./schedulers/retry.scheduler";
import { DeliveryReconciliationScheduler } from "./schedulers/delivery-reconciliation.scheduler";

// Guards
import { WebhookAuthGuard } from "./guards/webhook-auth.guard";

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    forwardRef(() => KdsModule),
    SubscriptionsModule,
    DeviceMeshModule,
  ],
  controllers: [
    DeliveryPlatformsController,
    DeliveryWebhookController,
    DeliveryDlqController,
  ],
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
    DeliveryTestService,
    DeliveryModerationService,
    DeliveryReconciliationService,

    // Schedulers
    OrderPollingScheduler,
    TokenRefreshScheduler,
    RetryScheduler,
    DeliveryReconciliationScheduler,

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
