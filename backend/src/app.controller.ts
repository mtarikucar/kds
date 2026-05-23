import { Controller, Get, HttpCode, Inject, Optional, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AppService } from './app.service';
import { Public } from './modules/auth/decorators/public.decorator';
import { captureException, captureMessage } from './sentry.config';
import { KMS_PROVIDER_TOKEN } from './modules/kms/kms.module';
import { KmsProvider } from './modules/kms/kms-provider.interface';
import { PaymentProviderRegistry } from './modules/payments-core/payment-provider.registry';
import { FiscalProviderRegistry } from './modules/fiscal-core/fiscal-provider.registry';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    // KMS + provider registries are optional so test contexts that
    // construct AppController standalone don't need to wire @Global modules.
    @Optional() @Inject(KMS_PROVIDER_TOKEN) private readonly kms?: KmsProvider,
    @Optional() private readonly payments?: PaymentProviderRegistry,
    @Optional() private readonly fiscal?: FiscalProviderRegistry,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Root endpoint' })
  getRoot(): object {
    return {
      service: 'HummyTummy API',
      version: '1.0.0',
      documentation: '/api/docs',
    };
  }

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Health check with database and Redis status' })
  async getHealth(): Promise<object> {
    return await this.appService.getHealth();
  }

  // ── Kubernetes-style health probes ────────────────────────────────────
  //
  // /healthz       : alias of /health, kept for K8s probe convention.
  // /healthz/live  : "process is alive" — fast, no I/O. K8s liveness probe.
  // /healthz/ready : "ready to serve traffic" — DB + Redis + adapters.
  //                  K8s readiness probe. Returns 503 when any subsystem
  //                  is unhealthy so the orchestrator stops routing.

  @Public()
  @Get('healthz')
  async healthz(): Promise<object> {
    return await this.appService.getHealth();
  }

  @Public()
  @Get('healthz/live')
  @HttpCode(200)
  liveness(): object {
    // Bumped on every restart via package.json. If this endpoint returns
    // 200, the process is alive — that's all liveness is supposed to
    // assert. Subsystem state belongs in /ready.
    return { ok: true, ts: new Date().toISOString() };
  }

  @Public()
  @Get('healthz/ready')
  async readiness(): Promise<object> {
    const base = await this.appService.getHealth();
    // Per-module checks. Optional dependencies are skipped when absent so
    // a partial deployment (e.g. payments disabled) doesn't trip readiness.
    // Short-circuit on first failure: K8s readiness probes are hot-path
    // (1Hz per pod across many pods); when KMS is down we don't need to
    // also enumerate every payment + fiscal provider before saying "no".
    const checks: Record<string, { ok: boolean; details?: unknown }> = {};

    if ((base as any).status !== 'ok') {
      return { ok: false, base, checks };
    }

    if (this.kms) {
      try {
        // Bound the probe — a network KMS that's hung would otherwise
        // stall the readiness response past the kubelet's timeoutSeconds
        // and cascade pod-not-ready → load-balancer drain → restart.
        // Same pattern AppService.getHealth uses for DB + Redis.
        let t: NodeJS.Timeout;
        const probe = Promise.race([
          this.kms.healthCheck(),
          new Promise<{ ok: false; details: any }>((_, reject) => {
            t = setTimeout(() => reject(new Error('kms timeout after 2000ms')), 2000);
          }),
        ]).finally(() => clearTimeout(t!));
        checks.kms = await probe;
      } catch (e) {
        checks.kms = { ok: false, details: { error: (e as Error).message } };
      }
      if (!checks.kms.ok) return { ok: false, base, checks };
    }

    if (this.payments) {
      const providers = this.payments.list();
      checks.payments = { ok: true, details: { installed: providers.map((p) => p.id) } };
      if (!checks.payments.ok) return { ok: false, base, checks };
    }

    if (this.fiscal) {
      const providers = this.fiscal.list();
      checks.fiscal = { ok: true, details: { installed: providers.map((p) => p.id) } };
      if (!checks.fiscal.ok) return { ok: false, base, checks };
    }

    return { ok: true, base, checks };
  }

  @Public()
  @Get('test-sentry')
  @ApiOperation({ summary: 'Test Sentry error tracking (dev only)' })
  testSentry(@Query('type') type?: string): object {
    if (process.env.NODE_ENV === 'production') {
      return { error: 'Not available in production' };
    }

    if (type === 'error') {
      const testError = new Error('Test error from Sentry integration');
      captureException(testError, { test: true, timestamp: new Date().toISOString() });
      throw testError;
    }

    if (type === 'message') {
      captureMessage('Test message from Sentry integration', 'info');
      return { success: true, message: 'Test message sent to Sentry' };
    }

    return {
      usage: 'Use ?type=error to trigger an error, ?type=message to send a message',
      examples: [
        '/api/test-sentry?type=error',
        '/api/test-sentry?type=message',
      ],
    };
  }
}
