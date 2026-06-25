import { Module, OnModuleInit } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { DeviceMeshModule } from "../device-mesh/device-mesh.module";
import { OrdersModule } from "../orders/orders.module";
import { PaymentTerminalProviderRegistry } from "./payment-terminal-provider.registry";
import { PaymentTerminalService } from "./payment-terminal.service";
import { PaymentTerminalController } from "./payment-terminal.controller";
import { SimulatorTerminalProvider } from "./providers/simulator-terminal.provider";

@Module({
  imports: [PrismaModule, DeviceMeshModule, OrdersModule],
  controllers: [PaymentTerminalController],
  providers: [
    PaymentTerminalProviderRegistry,
    PaymentTerminalService,
    SimulatorTerminalProvider,
    // P2/P3 register Gmp3CardTerminalProvider / BankEcrTerminalProvider /
    // SoftPosTerminalProvider here.
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
