import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// Config
import kafkaConfig from './kafka.config';

// Core service
import { KafkaService } from './kafka.service';

// Supporting services
import { IdempotencyService } from './services/idempotency.service';
import { DistributedLockService } from './services/distributed-lock.service';

// Producers
import { WebhookProducerService } from './producers/webhook-producer.service';

// Consumers
import { WebhookConsumerService } from './consumers/webhook-consumer.service';
import { DLQProducerService } from './consumers/dlq-producer.service';
import { DLQConsumerService } from './consumers/dlq-consumer.service';

// Health
import { KafkaHealthIndicator } from './health/kafka-health.indicator';

// Related modules
import { PrismaModule } from '../../prisma/prisma.module';
import { OrderIntegrationsModule } from '../order-integrations/order-integrations.module';

@Module({
  imports: [
    ConfigModule.forFeature(kafkaConfig),
    PrismaModule,
    forwardRef(() => OrderIntegrationsModule),
  ],
  providers: [
    // Core
    KafkaService,

    // Supporting services
    IdempotencyService,
    DistributedLockService,

    // Producers
    WebhookProducerService,
    DLQProducerService,

    // Consumers
    WebhookConsumerService,
    DLQConsumerService,

    // Health
    KafkaHealthIndicator,
  ],
  exports: [
    KafkaService,
    WebhookProducerService,
    IdempotencyService,
    DistributedLockService,
    KafkaHealthIndicator,
  ],
})
export class KafkaModule {}
