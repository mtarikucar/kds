import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Gmp3FiscalProviderBase } from "./gmp3-fiscal-provider.base";
import { FiscalProviderRegistry } from "../fiscal-provider.registry";
import { PrismaService } from "../../../prisma/prisma.service";
import { CommandQueueService } from "../../device-mesh/command-queue.service";

/**
 * Hugin new-generation yazarkasa (ÖKC) GMP-3 adapter.
 *
 * Thin subclass over {@link Gmp3FiscalProviderBase}: all of the GMP-3
 * line/payment/report framing and the local_bridge command-queue transport
 * live in the base. Here we only declare the vendor profile the bridge
 * dispatches on to load the Hugin SDK and the minimum GMP-3 revision.
 *
 * Self-registers with the FiscalProviderRegistry on boot, mirroring the
 * sibling adapters.
 */
@Injectable()
export class HuginFiscalProvider
  extends Gmp3FiscalProviderBase
  implements OnModuleInit
{
  readonly id = "fiscal_hugin";
  protected readonly logger = new Logger(HuginFiscalProvider.name);

  /** Bridge dispatches `hugin.gmp3` to the Hugin vendor SDK module. */
  protected readonly vendorProfile = "hugin.gmp3";
  /** Hugin ÖKC firmware family speaks GMP-3.x; require >= 3.1.0. */
  protected readonly sdkVersion = "3.1.0";

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
