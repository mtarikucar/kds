import { Module, OnModuleInit } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { DeviceMeshModule } from "../device-mesh/device-mesh.module";
import { OrdersModule } from "../orders/orders.module";
import { PaymentTerminalProviderRegistry } from "./payment-terminal-provider.registry";
import { PaymentTerminalService } from "./payment-terminal.service";
import { PaymentTerminalController } from "./payment-terminal.controller";
import { SimulatorTerminalProvider } from "./providers/simulator-terminal.provider";
import { Gmp3CardTerminalProvider } from "./providers/gmp3-card-terminal.provider";

@Module({
  imports: [PrismaModule, DeviceMeshModule, OrdersModule],
  controllers: [PaymentTerminalController],
  providers: [
    PaymentTerminalProviderRegistry,
    PaymentTerminalService,
    SimulatorTerminalProvider,
    // Self-registers via OnModuleInit (bridge, fiscal_coupled). Inert until a
    // terminal record using it is activated (CONFIGURED_NOT_ACTIVE by default).
    Gmp3CardTerminalProvider,
    // P3 adds BankEcrTerminalProvider / SoftPosTerminalProvider here.
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
