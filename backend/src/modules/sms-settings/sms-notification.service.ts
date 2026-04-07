import { Injectable, Logger } from '@nestjs/common';
import { SmsService } from '../customers/sms.service';
import { SmsSettingsService } from './sms-settings.service';

@Injectable()
export class SmsNotificationService {
  private readonly logger = new Logger(SmsNotificationService.name);

  constructor(
    private smsService: SmsService,
    private smsSettingsService: SmsSettingsService,
  ) {}

  // === RESERVATION SMS ===

  async notifyReservationCreated(tenantId: string, data: {
    customerPhone: string;
    customerName: string;
    date: string;
    startTime: string;
    reservationNumber: string;
  }) {
    await this.sendIfEnabled(tenantId, 'smsOnReservationCreated', data.customerPhone,
      `Sayin ${data.customerName}, ${data.date} tarihinde saat ${data.startTime} icin rezervasyonunuz alinmistir. Rezervasyon No: ${data.reservationNumber}. Onay icin sizinle iletisime gecilecektir.`,
    );
  }

  async notifyReservationConfirmed(tenantId: string, data: {
    customerPhone: string;
    customerName: string;
    date: string;
    startTime: string;
    reservationNumber: string;
  }) {
    await this.sendIfEnabled(tenantId, 'smsOnReservationConfirmed', data.customerPhone,
      `Sayin ${data.customerName}, ${data.date} tarihinde saat ${data.startTime} icin rezervasyonunuz onaylanmistir. Rezervasyon No: ${data.reservationNumber}. Hosgeldiniz!`,
    );
  }

  async notifyReservationRejected(tenantId: string, data: {
    customerPhone: string;
    customerName: string;
    date: string;
    startTime: string;
    reason?: string;
  }) {
    const reasonText = data.reason ? ` Sebep: ${data.reason}` : '';
    await this.sendIfEnabled(tenantId, 'smsOnReservationRejected', data.customerPhone,
      `Sayin ${data.customerName}, ${data.date} tarihinde saat ${data.startTime} icin rezervasyonunuz maalesef reddedilmistir.${reasonText} Baska bir zaman icin tekrar deneyebilirsiniz.`,
    );
  }

  async notifyReservationCancelled(tenantId: string, data: {
    customerPhone: string;
    customerName: string;
    date: string;
    startTime: string;
  }) {
    await this.sendIfEnabled(tenantId, 'smsOnReservationCancelled', data.customerPhone,
      `Sayin ${data.customerName}, ${data.date} tarihinde saat ${data.startTime} icin rezervasyonunuz iptal edilmistir.`,
    );
  }

  // === ORDER SMS ===

  async notifyOrderCreated(tenantId: string, data: {
    customerPhone: string;
    orderNumber: string;
  }) {
    await this.sendIfEnabled(tenantId, 'smsOnOrderCreated', data.customerPhone,
      `Siparissiniz alinmistir. Siparis No: ${data.orderNumber}. Siparissiniz en kisa surede hazirlanacaktir.`,
    );
  }

  async notifyOrderApproved(tenantId: string, data: {
    customerPhone: string;
    orderNumber: string;
  }) {
    await this.sendIfEnabled(tenantId, 'smsOnOrderApproved', data.customerPhone,
      `Siparissiniz onaylandi. Siparis No: ${data.orderNumber}. Hazirlama sureci baslamistir.`,
    );
  }

  async notifyOrderPreparing(tenantId: string, data: {
    customerPhone: string;
    orderNumber: string;
  }) {
    await this.sendIfEnabled(tenantId, 'smsOnOrderPreparing', data.customerPhone,
      `Siparissiniz hazirlaniyor. Siparis No: ${data.orderNumber}.`,
    );
  }

  async notifyOrderReady(tenantId: string, data: {
    customerPhone: string;
    orderNumber: string;
  }) {
    await this.sendIfEnabled(tenantId, 'smsOnOrderReady', data.customerPhone,
      `Siparissiniz hazir! Siparis No: ${data.orderNumber}. Afiyet olsun!`,
    );
  }

  async notifyOrderCancelled(tenantId: string, data: {
    customerPhone: string;
    orderNumber: string;
  }) {
    await this.sendIfEnabled(tenantId, 'smsOnOrderCancelled', data.customerPhone,
      `Siparissiniz iptal edilmistir. Siparis No: ${data.orderNumber}.`,
    );
  }

  // === CORE PRIVATE METHOD ===

  private async sendIfEnabled(
    tenantId: string,
    settingKey:
      | 'smsOnReservationCreated' | 'smsOnReservationConfirmed'
      | 'smsOnReservationRejected' | 'smsOnReservationCancelled'
      | 'smsOnOrderCreated' | 'smsOnOrderApproved'
      | 'smsOnOrderPreparing' | 'smsOnOrderReady' | 'smsOnOrderCancelled',
    phone: string,
    message: string,
  ): Promise<void> {
    try {
      if (!phone) return;

      const settings = await this.smsSettingsService.findByTenant(tenantId);
      if (!settings.isEnabled) return;
      if (!settings[settingKey]) return;

      this.smsService.send(phone, message).catch((err) => {
        this.logger.error(`SMS send failed for ${phone}: ${err.message}`);
      });
    } catch (err) {
      this.logger.error(`SMS notification check failed: ${err.message}`);
    }
  }
}
