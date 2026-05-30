import { Module, forwardRef } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
// v2.8.90: UsersService.resolveMaxUsers reads the engine for add-on
// SUM-aware caps. EntitlementsModule is a leaf — no inbound deps —
// so the import is cycle-safe.
import { EntitlementsModule } from '../entitlements/entitlements.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => AuthModule),
    EntitlementsModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
