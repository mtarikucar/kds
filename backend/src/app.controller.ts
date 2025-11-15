import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AppService } from './app.service';
import { Public } from './modules/auth/decorators/public.decorator';

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
}
