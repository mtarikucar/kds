import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { UpdatePosSettingsDto } from "./dto/update-pos-settings.dto";

@Injectable()
export class PosSettingsService {
  private readonly logger = new Logger(PosSettingsService.name);

  constructor(private prisma: PrismaService) {}

  async findByTenant(tenantId: string) {
    // v3.0.1 — findFirst + opportunistic create (with P2002 race-safety)
    // instead of upsert with compound-unique key. Prisma rejects
    // `findUnique`/`upsert` whose compound-unique key includes `branchId: null`
    // even when the underlying constraint allows NULL — see helper note
    // in branch-scope.ts. Two concurrent first-view calls still converge:
    // the loser catches P2002 (unique violation on the tenant-default
    // row) and re-reads instead of erroring.
    const existing = await this.prisma.posSettings.findFirst({
      where: { tenantId, branchId: null },
    });
    if (existing) return existing;
    try {
      return await this.prisma.posSettings.create({
        data: {
          tenantId,
          enableTablelessMode: false,
          enableTwoStepCheckout: true, // Default to true for better workflow
          enableCustomerOrdering: true,
        },
      });
    } catch (e: any) {
      if (e?.code === "P2002") {
        // A concurrent caller won the race; their row is now the
        // canonical tenant-default. Re-read and return it.
        const row = await this.prisma.posSettings.findFirst({
          where: { tenantId, branchId: null },
        });
        if (row) return row;
      }
      throw e;
    }
  }

  async update(tenantId: string, updateDto: UpdatePosSettingsDto) {
    // Wrap the read → validate → cancel-intents → write in a single
    // transaction. Two concerns the pre-iter-60 shape failed:
    //
    //   1. Race on create: findUnique → (settings is null) → create
    //      both fired from concurrent first-update calls hit P2002
    //      on the unique tenantId constraint. The upsert at the end
    //      collapses this into a single atomic write.
    //
    //   2. Self-pay cancel atomicity: the pendingSelfPayment.updateMany
    //      step used to run OUTSIDE the settings write, so a failure
    //      on the settings update (e.g. a Prisma validation error or
    //      a connection drop after the cancel completed) left every
    //      in-flight self-pay intent wrongly EXPIRED while the actual
    //      enableCustomerSelfPay flag was still TRUE. Co-locating
    //      both writes in one txn makes them succeed/fail together.
    let cancelledSelfPayIntents = 0;
    const settings = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.posSettings.findFirst({
        where: { tenantId, branchId: null },
      });

      // Note: Tableless mode and customer ordering can now work together
      // - With tableId: DINE_IN order (customer scans table QR)
      // - Without tableId (tableless mode): COUNTER order (customer orders without table)

      // Validation: Customer ordering requires two-step checkout
      if (updateDto.enableCustomerOrdering === true) {
        const willHaveTwoStepCheckout =
          updateDto.enableTwoStepCheckout !== undefined
            ? updateDto.enableTwoStepCheckout
            : (existing?.enableTwoStepCheckout ?? true);

        if (!willHaveTwoStepCheckout) {
          throw new BadRequestException(
            "İki aşamalı ödeme, QR menüden müşteri sipariş oluşturma için zorunludur. " +
              "Lütfen önce iki aşamalı ödemeyi etkinleştirin.",
          );
        }
      }

      // Validation: Cannot disable two-stage payment if customer ordering is active
      if (updateDto.enableTwoStepCheckout === false) {
        const willHaveCustomerOrdering =
          updateDto.enableCustomerOrdering !== undefined
            ? updateDto.enableCustomerOrdering
            : (existing?.enableCustomerOrdering ?? true);

        if (willHaveCustomerOrdering) {
          throw new BadRequestException(
            "QR menü sipariş aktifken iki aşamalı ödeme kapatılamaz. " +
              "Lütfen önce QR menüden müşteri sipariş oluşturmayı kapatın.",
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
        existing?.enableCustomerSelfPay === true
      ) {
        const cancelled = await tx.pendingSelfPayment.updateMany({
          where: { tenantId, status: "PENDING" },
          data: {
            status: "EXPIRED",
            failureReason: "tenant_disabled_self_pay",
          },
        });
        cancelledSelfPayIntents = cancelled.count;
      }

      // v3.0.1 — manual upsert because Prisma's upsert rejects
      // compound-unique with branchId: null (see findByTenant note).
      // Race-safety: the outer `existing` lookup is the pre-check; if
      // a parallel txn raced ahead and inserted the row between our
      // read and write, the update path's WHERE will still match and
      // the create path's P2002 catches the duplicate at the inner
      // catch.
      if (existing) {
        const updated = await tx.posSettings.updateMany({
          where: { tenantId, branchId: null },
          data: updateDto,
        });
        if (updated.count > 0) {
          return tx.posSettings.findFirstOrThrow({
            where: { tenantId, branchId: null },
          });
        }
      }
      try {
        return await tx.posSettings.create({
          data: {
            tenantId,
            enableTablelessMode: updateDto.enableTablelessMode ?? false,
            enableTwoStepCheckout: updateDto.enableTwoStepCheckout ?? true,
            enableCustomerOrdering: updateDto.enableCustomerOrdering ?? true,
            enableCustomerSelfPay: updateDto.enableCustomerSelfPay ?? false,
          },
        });
      } catch (e: any) {
        if (e?.code === "P2002") {
          // Concurrent first-update raced ahead; redo as an update
          // against the now-existing row.
          await tx.posSettings.updateMany({
            where: { tenantId, branchId: null },
            data: updateDto,
          });
          return tx.posSettings.findFirstOrThrow({
            where: { tenantId, branchId: null },
          });
        }
        throw e;
      }
    });

    if (cancelledSelfPayIntents > 0) {
      // Visible signal so an admin can see how many customers were
      // mid-flow when the toggle went off — needed for any dispute /
      // refund follow-up. Logged outside the txn so the log line only
      // fires when the txn actually committed.
      this.logger.warn(
        `Disabled self-pay for tenant ${tenantId}; cancelled ${cancelledSelfPayIntents} PENDING intent(s).`,
      );
    }

    return settings;
  }
}
