import { Injectable, Logger } from '@nestjs/common';
import { KafkaService } from '../kafka.service';
import { KafkaConsumerGroups } from '../interfaces/kafka-event.interface';

export interface KafkaHealthStatus {
  status: 'healthy' | 'unhealthy' | 'disabled';
  connected: boolean;
  consumerLag?: Record<string, number>;
  error?: string;
}

@Injectable()
export class KafkaHealthIndicator {
  private readonly logger = new Logger(KafkaHealthIndicator.name);

  constructor(private readonly kafkaService: KafkaService) {}

  /**
   * Check the health of Kafka connections and consumer lag
   */
  async checkHealth(): Promise<KafkaHealthStatus> {
    if (!this.kafkaService.isKafkaEnabled()) {
      return {
        status: 'disabled',
        connected: false,
      };
    }

    try {
      // Check if admin client can list topics
      const admin = this.kafkaService.getAdmin();
      await admin.listTopics();

      // Get consumer lag for all consumer groups
      const lagMetrics: Record<string, number> = {};
      const consumerGroups = [
        KafkaConsumerGroups.WEBHOOK_PROCESSORS,
        KafkaConsumerGroups.STATUS_SYNC_WORKERS,
        KafkaConsumerGroups.DLQ_REPROCESSORS,
      ];

      for (const groupId of consumerGroups) {
        try {
          const lag = await this.kafkaService.getConsumerLag(groupId);
          const totalLag = Object.values(lag).reduce((sum, l) => sum + l, 0);
          lagMetrics[groupId] = totalLag;
        } catch (error) {
          // Consumer group might not exist yet
          lagMetrics[groupId] = -1;
        }
      }

      // Consider unhealthy if any consumer has lag > 1000
      const maxLag = Math.max(...Object.values(lagMetrics).filter((l) => l >= 0));
      const isHealthy = maxLag < 1000;

      return {
        status: isHealthy ? 'healthy' : 'unhealthy',
        connected: true,
        consumerLag: lagMetrics,
      };
    } catch (error) {
      this.logger.error('Kafka health check failed', error);
      return {
        status: 'unhealthy',
        connected: false,
        error: error.message,
      };
    }
  }

  /**
   * Get detailed metrics for monitoring
   */
  async getMetrics(): Promise<{
    enabled: boolean;
    connected: boolean;
    consumerLag: Record<string, Record<string, number>>;
  }> {
    if (!this.kafkaService.isKafkaEnabled()) {
      return {
        enabled: false,
        connected: false,
        consumerLag: {},
      };
    }

    const consumerGroups = [
      KafkaConsumerGroups.WEBHOOK_PROCESSORS,
      KafkaConsumerGroups.STATUS_SYNC_WORKERS,
      KafkaConsumerGroups.DLQ_REPROCESSORS,
    ];

    const lagByGroup: Record<string, Record<string, number>> = {};

    for (const groupId of consumerGroups) {
      try {
        lagByGroup[groupId] = await this.kafkaService.getConsumerLag(groupId);
      } catch (error) {
        lagByGroup[groupId] = {};
      }
    }

    return {
      enabled: true,
      connected: true,
      consumerLag: lagByGroup,
    };
  }
}
