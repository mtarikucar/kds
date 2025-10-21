import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Root endpoint' })
  getRoot(): object {
    return {
      service: 'Restaurant POS API',
      version: '1.0.0',
      documentation: '/api/docs',
    };
  }

  @Get('health')
  @ApiOperation({ summary: 'Health check with database and Redis status' })
  async getHealth(): Promise<object> {
    return await this.appService.getHealth();
  }
}
