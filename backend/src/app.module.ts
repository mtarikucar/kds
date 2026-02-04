import { Module, NestModule, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UsersModule } from './modules/users/users.module';
import { MenuModule } from './modules/menu/menu.module';
import { TablesModule } from './modules/tables/tables.module';
import { OrdersModule } from './modules/orders/orders.module';
import { KdsModule } from './modules/kds/kds.module';
import { StockModule } from './modules/stock/stock.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { UploadModule } from './modules/upload/upload.module';
import { QrModule } from './modules/qr/qr.module';
import { PosSettingsModule } from './modules/pos-settings/pos-settings.module';
import { SettingsModule } from './modules/settings/settings.module';
import { ContactModule } from './modules/contact/contact.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ZReportsModule } from './modules/z-reports/z-reports.module';
import { CustomersModule } from './modules/customers/customers.module';
import { ModifiersModule } from './modules/modifiers/modifiers.module';
import { CustomerOrdersModule } from './modules/customer-orders/customer-orders.module';
import { DesktopAppModule } from './modules/desktop-app/desktop-app.module';
import { PublicStatsModule } from './modules/public-stats/public-stats.module';
import { LayoutsModule } from './modules/layouts/layouts.module';
import { SuperAdminModule } from './modules/superadmin/superadmin.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';
import { InputSanitizerMiddleware, SqlInjectionPreventionMiddleware } from './common/middleware/input-sanitizer.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    // Rate limiting protection
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000, // 1 second
        limit: 10, // 10 requests per second
      },
      {
        name: 'medium',
        ttl: 10000, // 10 seconds
        limit: 50, // 50 requests per 10 seconds
      },
      {
        name: 'long',
        ttl: 60000, // 1 minute
        limit: 100, // 100 requests per minute
      },
    ]),
    PrismaModule,
    CommonModule,
    AuthModule,
    SubscriptionsModule,
    TenantsModule,
    UsersModule,
    MenuModule,
    TablesModule,
    OrdersModule,
    KdsModule,
    StockModule,
    ReportsModule,
    UploadModule,
    QrModule,
    PosSettingsModule,
    SettingsModule,
    ContactModule,
    NotificationsModule,
    ZReportsModule,
    CustomersModule,
    ModifiersModule,
    CustomerOrdersModule,
    DesktopAppModule,
    PublicStatsModule,
    LayoutsModule,
    SuperAdminModule,
    AnalyticsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global rate limiting guard
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply request logger to all routes
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');

    // Apply SQL injection check BEFORE sanitization (so URLs aren't escaped yet)
    // Exclude desktop CI endpoints from input sanitization (they use API key auth and need raw URLs)
    consumer
      .apply(SqlInjectionPreventionMiddleware, InputSanitizerMiddleware)
      .exclude(
        { path: 'desktop/ci/releases', method: RequestMethod.POST },
        { path: 'desktop/ci/releases/:id/publish', method: RequestMethod.POST },
      )
      .forRoutes('*');
  }
}
