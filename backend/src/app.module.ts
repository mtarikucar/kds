import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
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
import { ReservationsModule } from './modules/reservations/reservations.module';
import { DeliveryPlatformsModule } from './modules/delivery-platforms/delivery-platforms.module';
import { PersonnelModule } from './modules/personnel/personnel.module';
import { StockManagementModule } from './modules/stock-management/stock-management.module';
import { MarketingModule } from './modules/marketing/marketing.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { SmsSettingsModule } from './modules/sms-settings/sms-settings.module';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    // Single root-level scheduler. Previously `ScheduleModule.forRoot()` was
    // called in z-reports, delivery-platforms, public-stats, and subscriptions
    // submodules. Nest tolerated it but every replica still runs every job;
    // leader-election / distributed locks live in the schedulers themselves.
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,
        limit: 10,
      },
      {
        name: 'medium',
        ttl: 10000,
        limit: 50,
      },
      {
        name: 'long',
        ttl: 60000,
        limit: 100,
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
    ReservationsModule,
    DeliveryPlatformsModule,
    PersonnelModule,
    StockManagementModule,
    MarketingModule,
    SmsSettingsModule,
    AccountingModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // InputSanitizerMiddleware (HTML-escape every request string) and
    // SqlInjectionPreventionMiddleware (regex pattern theater; Prisma is
    // parameterized anyway) were removed — they corrupted legitimate input
    // (O'Brien → O&#x27;Brien, OAuth codes, Apple JWTs) and raised
    // false-positive 400s on every apostrophe.
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
