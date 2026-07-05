import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Gmp3FiscalProviderBase } from "./gmp3-fiscal-provider.base";
import { FiscalProviderRegistry } from "../fiscal-provider.registry";
import { PrismaService } from "../../../prisma/prisma.service";
import { CommandQueueService } from "../../device-mesh/command-queue.service";

/**
 * Paygo SP630PRO ECR (Token/Paygo *Yeni Nesil ÖKC*) — standalone fiscal rail.
 *
 * The SP630 also charges cards (see the payment-terminal `paygo_ecr` provider,
 * which prints the fiş atomically in the same op as a card charge). THIS adapter
 * covers the other half: sales settled by **cash / meal-card / non-card** tenders
 * still legally require a mali fiş, and those are issued here — the device prints
 * the fiş with no card leg.
 *
 * Thin subclass over {@link Gmp3FiscalProviderBase}: the GMP-3 receipt/void/report
 * framing and the local_bridge command-queue transport live in the base. Here we
 * only declare the vendor profile the bridge's vendor-neutral `gmp3` driver
 * dispatches on to load the Paygo SP630 profile, and the minimum GMP-3 revision.
 *
 * Ships INERT: it only issues once an operator registers a `fiscal_paygo` device
 * AND links a mesh device; absent that, resolveMeshDevice throws. No tenant has
 * one, and the on-prem `gmp3` driver fails closed until Phase 1 certifies the real
 * handshake — so no fiş is ever fabricated. Self-registers on boot like siblings.
 */
@Injectable()
export class PaygoFiscalProvider
  extends Gmp3FiscalProviderBase
  implements OnModuleInit
{
  readonly id = "fiscal_paygo";
  protected readonly logger = new Logger(PaygoFiscalProvider.name);

  /** Bridge dispatches `paygo.sp630` to the Paygo profile of the gmp3 driver. */
  protected readonly vendorProfile = "paygo.sp630";
  /** Paygo SP630 ECR firmware family speaks GMP-3.x; require >= 3.2.0. */
  protected readonly sdkVersion = "3.2.0";

  constructor(
    registry: FiscalProviderRegistry,
    prisma: PrismaService,
    commandQueue: CommandQueueService,
  ) {
    super(registry, prisma, commandQueue);
  }

  onModuleInit(): void {
    this.registry.register(this);
  }
}
