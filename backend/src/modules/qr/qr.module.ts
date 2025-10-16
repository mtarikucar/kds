import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { QrController } from './qr.controller';
import { QrService } from './qr.service';

@Module({
  imports: [PrismaModule],
  controllers: [QrController],
  providers: [QrService],
  exports: [QrService],
})
export class QrModule {}
