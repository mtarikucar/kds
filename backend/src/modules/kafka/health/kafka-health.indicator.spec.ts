import { Test, TestingModule } from '@nestjs/testing';
import { KafkaHealthIndicator } from './kafka-health.indicator';
import { KafkaService } from '../kafka.service';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';

describe('KafkaHealthIndicator', () => {
  let indicator: KafkaHealthIndicator;
  let kafkaService: DeepMockProxy<KafkaService>;

  beforeEach(async () => {
    kafkaService = mockDeep<KafkaService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KafkaHealthIndicator,
        { provide: KafkaService, useValue: kafkaService },
      ],
    }).compile();

    indicator = module.get<KafkaHealthIndicator>(KafkaHealthIndicator);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('checkHealth', () => {
    it('should return disabled status when kafka disabled', async () => {
      kafkaService.isKafkaEnabled.mockReturnValue(false);

      const result = await indicator.checkHealth();

      expect(result).toEqual({
        status: 'disabled',
        connected: false,
      });
    });

    it('should return healthy when connected and lag < 1000', async () => {
      kafkaService.isKafkaEnabled.mockReturnValue(true);
      kafkaService.getAdmin.mockReturnValue({
        listTopics: jest.fn().mockResolvedValue(['topic-1']),
      } as any);
      kafkaService.getConsumerLag.mockResolvedValue({ 'topic-1': 100 });

      const result = await indicator.checkHealth();

      expect(result.status).toBe('healthy');
      expect(result.connected).toBe(true);
      expect(result.consumerLag).toBeDefined();
    });

    it('should return unhealthy when lag >= 1000', async () => {
      kafkaService.isKafkaEnabled.mockReturnValue(true);
      kafkaService.getAdmin.mockReturnValue({
        listTopics: jest.fn().mockResolvedValue(['topic-1']),
      } as any);
      kafkaService.getConsumerLag.mockResolvedValue({ 'topic-1': 1500 });

      const result = await indicator.checkHealth();

      expect(result.status).toBe('unhealthy');
      expect(result.connected).toBe(true);
    });

    it('should return unhealthy on connection failure', async () => {
      kafkaService.isKafkaEnabled.mockReturnValue(true);
      kafkaService.getAdmin.mockReturnValue({
        listTopics: jest.fn().mockRejectedValue(new Error('Connection failed')),
      } as any);

      const result = await indicator.checkHealth();

      expect(result.status).toBe('unhealthy');
      expect(result.connected).toBe(false);
      expect(result.error).toBe('Connection failed');
    });

    it('should handle consumer lag retrieval errors gracefully', async () => {
      kafkaService.isKafkaEnabled.mockReturnValue(true);
      kafkaService.getAdmin.mockReturnValue({
        listTopics: jest.fn().mockResolvedValue(['topic-1']),
      } as any);
      kafkaService.getConsumerLag.mockRejectedValue(new Error('Group not found'));

      const result = await indicator.checkHealth();

      expect(result.status).toBe('healthy');
      expect(result.consumerLag).toBeDefined();
    });
  });

  describe('getMetrics', () => {
    it('should return disabled metrics when kafka disabled', async () => {
      kafkaService.isKafkaEnabled.mockReturnValue(false);

      const result = await indicator.getMetrics();

      expect(result).toEqual({
        enabled: false,
        connected: false,
        consumerLag: {},
      });
    });

    it('should return detailed lag metrics per consumer group', async () => {
      kafkaService.isKafkaEnabled.mockReturnValue(true);
      kafkaService.getConsumerLag
        .mockResolvedValueOnce({ 'topic-1': 50, 'topic-2': 30 })
        .mockResolvedValueOnce({ 'topic-1': 10 })
        .mockResolvedValueOnce({});

      const result = await indicator.getMetrics();

      expect(result.enabled).toBe(true);
      expect(result.connected).toBe(true);
      expect(result.consumerLag['webhook-processors']).toEqual({ 'topic-1': 50, 'topic-2': 30 });
      expect(result.consumerLag['status-sync-workers']).toEqual({ 'topic-1': 10 });
      expect(result.consumerLag['dlq-reprocessors']).toEqual({});
    });

    it('should handle consumer lag errors gracefully', async () => {
      kafkaService.isKafkaEnabled.mockReturnValue(true);
      kafkaService.getConsumerLag.mockRejectedValue(new Error('Error'));

      const result = await indicator.getMetrics();

      expect(result.enabled).toBe(true);
      expect(result.connected).toBe(true);
      // All groups should have empty objects due to error handling
      expect(Object.values(result.consumerLag).every((v) => Object.keys(v).length === 0)).toBe(true);
    });
  });
});
