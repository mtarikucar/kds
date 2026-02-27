import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { KdsGateway } from './kds.gateway';
import { KdsService } from './kds.service';
import { KdsController } from './kds.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { OrdersModule } from '../orders/orders.module';
import { DeliveryPlatformsModule } from '../delivery-platforms/delivery-platforms.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => OrdersModule),
    forwardRef(() => DeliveryPlatformsModule),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRES_IN') || '7d',
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [KdsController],
  providers: [KdsGateway, KdsService],
  exports: [KdsGateway, KdsService],
})
export class KdsModule {}
