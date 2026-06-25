import { Module, OnModuleInit } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { DeviceMeshModule } from "../device-mesh/device-mesh.module";
import { OrdersModule } from "../orders/orders.module";
import { PaymentTerminalProviderRegistry } from "./payment-terminal-provider.registry";
import { PaymentTerminalService } from "./payment-terminal.service";
import { PaymentTerminalController } from "./payment-terminal.controller";
import { SimulatorTerminalProvider } from "./providers/simulator-terminal.provider";
import { Gmp3CardTerminalProvider } from "./providers/gmp3-card-terminal.provider";
import { BankEcrTerminalProvider } from "./providers/bank-ecr-terminal.provider";
import { SoftPosTerminalProvider } from "./providers/softpos-terminal.provider";

@Module({
  imports: [PrismaModule, DeviceMeshModule, OrdersModule],
  controllers: [PaymentTerminalController],
  providers: [
    PaymentTerminalProviderRegistry,
    PaymentTerminalService,
    SimulatorTerminalProvider,
    // All self-register via OnModuleInit. Inert until a terminal record using
    // them is activated (CONFIGURED_NOT_ACTIVE by default; SoftPOS can't be
    // activated at all yet — activatable=false).
    Gmp3CardTerminalProvider, // bridge, fiscal_coupled (charge + fiş atomic)
    BankEcrTerminalProvider, // bridge, charge-only (fiş via the existing rail)
    SoftPosTerminalProvider, // in_process PSP, fail-closed (not yet wired)
  ],
  exports: [PaymentTerminalService, PaymentTerminalProviderRegistry],
})
export class PaymentTerminalModule implements OnModuleInit {
  constructor(
    private readonly registry: PaymentTerminalProviderRegistry,
    private readonly simulator: SimulatorTerminalProvider,
  ) {}

  onModuleInit() {
    this.registry.register(this.simulator);
  }
}
