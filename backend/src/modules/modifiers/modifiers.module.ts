import { Module } from '@nestjs/common';
import { ModifiersService } from './services/modifiers.service';
import { ModifiersController } from './controllers/modifiers.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ModifiersController],
  providers: [ModifiersService],
  exports: [ModifiersService],
})
export class ModifiersModule {}
