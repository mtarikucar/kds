import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { SmsService } from './sms.service';

/**
 * Iter-41 regressions:
 *
 *  1. mockMode must REFUSE to start under NODE_ENV=production unless
 *     the explicit ALLOW_MOCK_SMS_IN_PROD=true escape hatch is set.
 *     A config typo dropping the provider env vars previously fell
 *     through to mockMode silently — the send path then logged the
 *     full OTP + phone in plaintext.
 *  2. The mock-mode log line must mask the phone (PII).
 *  3. The retry path's "send failed" log lines must mask the phone.
 */
describe('SmsService (iter-41)', () => {
  const baseEnv = { ...process.env };
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    errSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    process.env = { ...baseEnv };
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });

  function makeConfig(env: Record<string, string | undefined>): ConfigService {
    return {
      get: (key: string) => env[key],
    } as ConfigService;
  }

  describe('mockMode prod refusal', () => {
    it('throws at construction when NODE_ENV=production and no provider is configured', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.ALLOW_MOCK_SMS_IN_PROD;

      expect(() => new SmsService(makeConfig({}))).toThrow(
        /SMS provider not configured in production/,
      );
    });

    it('allows mockMode in production with the explicit escape hatch', () => {
      process.env.NODE_ENV = 'production';
      process.env.ALLOW_MOCK_SMS_IN_PROD = 'true';

      expect(() => new SmsService(makeConfig({}))).not.toThrow();
    });

    it('allows mockMode in non-production', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.ALLOW_MOCK_SMS_IN_PROD;

      expect(() => new SmsService(makeConfig({}))).not.toThrow();
    });
  });

  describe('phone PII masking', () => {
    it('masks the phone in the mock-mode log line (OTP stays for dev visibility)', async () => {
      process.env.NODE_ENV = 'development';
      const svc = new SmsService(makeConfig({}));

      await svc.send('+905551234567', 'OTP: 123456');

      // Find the [MOCK SMS] log entry — the full message stays so a
      // developer can verify the OTP locally, but the phone is masked.
      const calls = logSpy.mock.calls.map((c) => c.join(' '));
      const mockLog = calls.find((c) => c.includes('[MOCK SMS]'));
      expect(mockLog).toBeDefined();
      expect(mockLog).not.toContain('+905551234567');
      expect(mockLog).toMatch(/\*/);
      // OTP stays in the line — that's the load-bearing dev-mode use
      // case; only the phone is sensitive at this layer.
      expect(mockLog).toContain('OTP: 123456');
    });
  });
});
