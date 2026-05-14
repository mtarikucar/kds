import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdatePosSettingsDto } from './dto/update-pos-settings.dto';

@Injectable()
export class PosSettingsService {
  constructor(private prisma: PrismaService) {}

  async findByTenant(tenantId: string) {
    // Atomic upsert so two concurrent "first view" calls don't race on
    // create and hit P2002. The update branch is a no-op when the row
    // already exists — just returns it.
    return this.prisma.posSettings.upsert({
      where: { tenantId },
      update: {},
      create: {
        tenantId,
        enableTablelessMode: false,
        enableTwoStepCheckout: true, // Default to true for better workflow
        enableCustomerOrdering: true,
      },
    });
  }

  async update(tenantId: string, updateDto: UpdatePosSettingsDto) {
    // Find existing settings or create if not exists
    let settings = await this.prisma.posSettings.findUnique({
      where: { tenantId },
    });

    // Note: Tableless mode and customer ordering can now work together
    // - With tableId: DINE_IN order (customer scans table QR)
    // - Without tableId (tableless mode): COUNTER order (customer orders without table)

    // Validation: Customer ordering requires two-step checkout
    if (updateDto.enableCustomerOrdering === true) {
      const willHaveTwoStepCheckout =
        updateDto.enableTwoStepCheckout !== undefined
          ? updateDto.enableTwoStepCheckout
          : settings?.enableTwoStepCheckout ?? true;

      if (!willHaveTwoStepCheckout) {
        throw new BadRequestException(
          'İki aşamalı ödeme, QR menüden müşteri sipariş oluşturma için zorunludur. ' +
          'Lütfen önce iki aşamalı ödemeyi etkinleştirin.'
        );
      }
    }

    // Validation: Cannot disable two-stage payment if customer ordering is active
    if (updateDto.enableTwoStepCheckout === false) {
      const willHaveCustomerOrdering =
        updateDto.enableCustomerOrdering !== undefined
          ? updateDto.enableCustomerOrdering
          : settings?.enableCustomerOrdering ?? true;

      if (willHaveCustomerOrdering) {
        throw new BadRequestException(
          'QR menü sipariş aktifken iki aşamalı ödeme kapatılamaz. ' +
          'Lütfen önce QR menüden müşteri sipariş oluşturmayı kapatın.'
        );
      }
    }

    // Validation: Self-pay is Turkey-only (PayTR is the sole provider).
    // The runtime path also rejects non-Turkey tenants, but failing
    // here gives a clearer error before the QR menu starts showing
    // a button that won't work.
    if (updateDto.enableCustomerSelfPay === true) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { paymentRegion: true },
      });
      if (tenant?.paymentRegion !== 'TURKEY') {
        throw new BadRequestException(
          'Self-pay yalnızca Türkiye bölgesindeki tenantlar için kullanılabilir. ' +
          'Önce Tenant ayarlarından "Ödeme Bölgesi"ni TURKEY olarak ayarlayın.'
        );
      }
    }

    // Disabling self-pay must immediately release any in-flight
    // intents — otherwise their PENDING status keeps reserving items
    // and blocks the waiter from collecting cash for up to 15 minutes
    // (until the sweeper expires them). The owner toggling OFF is
    // an explicit "I want to take over this manually" signal.
    if (
      updateDto.enableCustomerSelfPay === false &&
      settings?.enableCustomerSelfPay === true
    ) {
      const cancelled = await this.prisma.pendingSelfPayment.updateMany({
        where: { tenantId, status: 'PENDING' },
        data: {
          status: 'EXPIRED',
          failureReason: 'tenant_disabled_self_pay',
        },
      });
      if (cancelled.count > 0) {
        // Visible signal so an admin can see how many customers
        // were mid-flow when the toggle went off — needed for any
        // dispute / refund follow-up.
        // eslint-disable-next-line no-console
        console.warn(
          `[pos-settings] Disabled self-pay for tenant ${tenantId}; ` +
            `cancelled ${cancelled.count} PENDING intent(s).`,
        );
      }
    }

    if (!settings) {
      // Create new settings if they don't exist
      settings = await this.prisma.posSettings.create({
        data: {
          tenantId,
          enableTablelessMode: updateDto.enableTablelessMode ?? false,
          enableTwoStepCheckout: updateDto.enableTwoStepCheckout ?? true, // Default to true
          enableCustomerOrdering: updateDto.enableCustomerOrdering ?? true,
          enableCustomerSelfPay: updateDto.enableCustomerSelfPay ?? false,
        },
      });
    } else {
      // Update existing settings
      settings = await this.prisma.posSettings.update({
        where: { tenantId },
        data: updateDto,
      });
    }

    return settings;
  }
}
