import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Gmp3FiscalProviderBase } from "./gmp3-fiscal-provider.base";
import { FiscalProviderRegistry } from "../fiscal-provider.registry";
import { PrismaService } from "../../../prisma/prisma.service";
import { CommandQueueService } from "../../device-mesh/command-queue.service";

/**
 * Beko (Token/Beko ÖKC) new-generation yazarkasa GMP-3 adapter.
 *
 * Thin subclass over {@link Gmp3FiscalProviderBase}: the GMP-3 receipt/void/
 * report framing and the local_bridge command-queue transport live in the
 * base. Here we only declare the vendor profile the bridge dispatches on to
 * load the Beko SDK and the minimum GMP-3 revision.
 *
 * Self-registers with the FiscalProviderRegistry on boot, mirroring the
 * sibling adapters.
 */
@Injectable()
export class BekoFiscalProvider
  extends Gmp3FiscalProviderBase
  implements OnModuleInit
{
  readonly id = "fiscal_beko";
  protected readonly logger = new Logger(BekoFiscalProvider.name);

  /** Bridge dispatches `beko.gmp3` to the Beko vendor SDK module. */
  protected readonly vendorProfile = "beko.gmp3";
  /** Beko ÖKC firmware family speaks GMP-3.x; require >= 3.0.0. */
  protected readonly sdkVersion = "3.0.0";

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
