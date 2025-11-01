import { Module } from '@nestjs/common';
import { DesktopAppService } from './desktop-app.service';
import { DesktopAppController } from './desktop-app.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [DesktopAppController],
  providers: [DesktopAppService],
  exports: [DesktopAppService],
})
export class DesktopAppModule {}
