import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { SuperAdminTerminalGateway } from './superadmin-terminal.gateway';
import { SuperAdminTerminalService } from './superadmin-terminal.service';

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('SUPERADMIN_JWT_SECRET'),
        signOptions: {
          expiresIn: '1h',
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [SuperAdminTerminalGateway, SuperAdminTerminalService],
})
export class SuperAdminTerminalModule {}
