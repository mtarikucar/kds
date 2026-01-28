import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AppService } from './app.service';
import { Public } from './modules/auth/decorators/public.decorator';
import { captureException, captureMessage } from './sentry.config';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

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
