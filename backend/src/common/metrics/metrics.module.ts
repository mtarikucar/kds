import { Global, Module } from "@nestjs/common";
import { MetricsController } from "./metrics.controller";
import { MetricsService } from "./metrics.service";

/**
 * @Global so RequestLoggerMiddleware (configured in AppModule) and any
 * feature module that wants custom counters can inject MetricsService
 * without an explicit import — same posture as CommonModule/OutboxModule.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
