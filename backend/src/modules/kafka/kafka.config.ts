import { registerAs } from '@nestjs/config';

export interface KafkaConfig {
  brokers: string[];
  clientId: string;
  enabled: boolean;
  useKafkaDLQ: boolean;
  producer: {
    idempotent: boolean;
    maxInFlightRequests: number;
    transactionTimeout: number;
  };
  consumer: {
    sessionTimeout: number;
    heartbeatInterval: number;
    maxBytesPerPartition: number;
  };
  retry: {
    initialRetryTime: number;
    maxRetries: number;
    maxRetryTime: number;
  };
}

export default registerAs(
  'kafka',
  (): KafkaConfig => ({
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    clientId: process.env.KAFKA_CLIENT_ID || 'kds-order-integration',
    enabled: process.env.KAFKA_ENABLED === 'true',
    useKafkaDLQ: process.env.USE_KAFKA_DLQ === 'true',
    producer: {
      idempotent: true,
      maxInFlightRequests: 5,
      transactionTimeout: 60000,
    },
    consumer: {
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      maxBytesPerPartition: 1048576, // 1MB
    },
    retry: {
      initialRetryTime: 100,
      maxRetries: 8,
      maxRetryTime: 30000,
    },
  }),
);
