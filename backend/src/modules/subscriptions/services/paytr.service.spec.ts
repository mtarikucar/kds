import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { PaytrService, PaytrCallbackPayload } from './paytr.service';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('PaytrService', () => {
  let service: PaytrService;
  let configService: ConfigService;

  const mockConfig = {
    PAYTR_MERCHANT_ID: 'test_merchant_id',
    PAYTR_MERCHANT_KEY: 'test_merchant_key',
    PAYTR_MERCHANT_SALT: 'test_merchant_salt',
    PAYTR_BASE_URL: 'https://www.paytr.com',
    PAYTR_TEST_MODE: 'true',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaytrService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              return mockConfig[key] ?? defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<PaytrService>(PaytrService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('isConfigured', () => {
    it('should return true when all credentials are configured', () => {
      expect(service.isConfigured()).toBe(true);
    });

    it('should return false when credentials are missing', async () => {
      const moduleWithoutConfig = await Test.createTestingModule({
        providers: [
          PaytrService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn(() => ''),
            },
          },
        ],
      }).compile();

      const serviceWithoutConfig = moduleWithoutConfig.get<PaytrService>(PaytrService);
      expect(serviceWithoutConfig.isConfigured()).toBe(false);
    });
  });

  describe('createPaymentLink', () => {
    const mockParams = {
      merchantOid: 'SUB-123-1234567890',
      email: 'test@example.com',
      amount: 299.99,
      userName: 'Test User',
      userPhone: '5551234567',
      description: 'Pro Plan - Aylik',
      successUrl: 'https://example.com/success',
      failUrl: 'https://example.com/fail',
      maxInstallment: 1,
      expiryDuration: 30,
    };

    it('should create payment link successfully', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          status: 'success',
          token: 'test_payment_token_123',
        },
      });

      const result = await service.createPaymentLink(mockParams);

      expect(result.status).toBe('success');
      expect(result.link).toBe('https://www.paytr.com/odeme/guvenli/test_payment_token_123');
      expect(result.token).toBe('test_payment_token_123');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://www.paytr.com/odeme/api/get-token',
        expect.any(String),
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }),
      );
    });

    it('should return failed status when PayTR API fails', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          status: 'failed',
          reason: 'Invalid merchant credentials',
        },
      });

      const result = await service.createPaymentLink(mockParams);

      expect(result.status).toBe('failed');
      expect(result.reason).toBe('Invalid merchant credentials');
    });

    it('should throw BadRequestException when API request fails', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('Network error'));

      await expect(service.createPaymentLink(mockParams)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when service is not configured', async () => {
      const moduleWithoutConfig = await Test.createTestingModule({
        providers: [
          PaytrService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn(() => ''),
            },
          },
        ],
      }).compile();

      const serviceWithoutConfig = moduleWithoutConfig.get<PaytrService>(PaytrService);

      await expect(serviceWithoutConfig.createPaymentLink(mockParams)).rejects.toThrow(
        'PayTR payment service is not configured',
      );
    });

    it('should convert amount to kurus correctly', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { status: 'success', token: 'token123' },
      });

      await service.createPaymentLink({ ...mockParams, amount: 100.50 });

      const postCall = mockedAxios.post.mock.calls[0];
      const postData = postCall[1] as string;

      // Amount should be 10050 kurus (100.50 * 100)
      expect(postData).toContain('payment_amount=10050');
    });

    it('should set test_mode correctly', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { status: 'success', token: 'token123' },
      });

      await service.createPaymentLink(mockParams);

      const postCall = mockedAxios.post.mock.calls[0];
      const postData = postCall[1] as string;

      expect(postData).toContain('test_mode=1');
    });
  });

  describe('verifyCallback', () => {
    it('should return true for valid callback hash', () => {
      // Create a valid hash for testing
      const crypto = require('crypto');
      const hashStr = 'test_merchant_oid' + mockConfig.PAYTR_MERCHANT_SALT + 'success' + '29999';
      const expectedHash = crypto
        .createHmac('sha256', mockConfig.PAYTR_MERCHANT_KEY)
        .update(hashStr)
        .digest('base64');

      const payload: PaytrCallbackPayload = {
        merchant_oid: 'test_merchant_oid',
        status: 'success',
        total_amount: '29999',
        hash: expectedHash,
      };

      expect(service.verifyCallback(payload)).toBe(true);
    });

    it('should return false for invalid callback hash', () => {
      const payload: PaytrCallbackPayload = {
        merchant_oid: 'test_merchant_oid',
        status: 'success',
        total_amount: '29999',
        hash: 'invalid_hash_value',
      };

      expect(service.verifyCallback(payload)).toBe(false);
    });

    it('should return false when hash is tampered', () => {
      const crypto = require('crypto');
      // Create hash with different amount
      const hashStr = 'test_merchant_oid' + mockConfig.PAYTR_MERCHANT_SALT + 'success' + '10000';
      const tamperedHash = crypto
        .createHmac('sha256', mockConfig.PAYTR_MERCHANT_KEY)
        .update(hashStr)
        .digest('base64');

      const payload: PaytrCallbackPayload = {
        merchant_oid: 'test_merchant_oid',
        status: 'success',
        total_amount: '29999', // Different from hash calculation
        hash: tamperedHash,
      };

      expect(service.verifyCallback(payload)).toBe(false);
    });
  });

  describe('parseCallback', () => {
    it('should parse successful callback correctly', () => {
      const payload: PaytrCallbackPayload = {
        merchant_oid: 'SUB-123-1234567890',
        status: 'success',
        total_amount: '29999',
        hash: 'some_hash',
        payment_type: 'card',
        currency: 'TL',
        test_mode: '1',
      };

      const result = service.parseCallback(payload);

      expect(result).toEqual({
        merchantOid: 'SUB-123-1234567890',
        status: 'success',
        totalAmount: 299.99,
        failedReason: undefined,
        paymentType: 'card',
        currency: 'TL',
        isTestMode: true,
      });
    });

    it('should parse failed callback correctly', () => {
      const payload: PaytrCallbackPayload = {
        merchant_oid: 'SUB-123-1234567890',
        status: 'failed',
        total_amount: '29999',
        hash: 'some_hash',
        failed_reason_code: 'INSUFFICIENT_FUNDS',
        failed_reason_msg: 'Yetersiz bakiye',
        test_mode: '0',
      };

      const result = service.parseCallback(payload);

      expect(result).toEqual({
        merchantOid: 'SUB-123-1234567890',
        status: 'failed',
        totalAmount: 299.99,
        failedReason: 'Yetersiz bakiye',
        paymentType: undefined,
        currency: 'TRY',
        isTestMode: false,
      });
    });

    it('should convert kurus to TRY correctly', () => {
      const payload: PaytrCallbackPayload = {
        merchant_oid: 'test',
        status: 'success',
        total_amount: '10050', // 100.50 TRY
        hash: 'hash',
      };

      const result = service.parseCallback(payload);

      expect(result.totalAmount).toBe(100.50);
    });

    it('should default currency to TRY when not provided', () => {
      const payload: PaytrCallbackPayload = {
        merchant_oid: 'test',
        status: 'success',
        total_amount: '10000',
        hash: 'hash',
      };

      const result = service.parseCallback(payload);

      expect(result.currency).toBe('TRY');
    });
  });
});
