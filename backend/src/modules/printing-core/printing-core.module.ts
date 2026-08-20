import { Global, Module } from "@nestjs/common";
import { EscPosBuilderRegistry } from "./escpos-builder.registry";
import { EscPosBuilderService } from "./escpos-builder.service";
import { EscPosBuilderUzService } from "./escpos-builder-uz.service";

/**
 * Printing-core module. Mirrors payments-core / fiscal-core: a small
 * @Global() module whose only job is to hold a registry and the concrete
 * adapter(s) that self-register into it at boot (EscPosBuilderService
 * registers as "escpos-tr", EscPosBuilderUzService as "escpos-uz" — Task
 * 13 — in their onModuleInit()).
 *
 * Extracted out of DeviceMeshModule (Task 9 fix round 1) so a module that
 * only needs to RESOLVE a builder by id — the country-capability resolver,
 * chiefly — doesn't have to pull in device-mesh's much larger graph
 * (LocalBridgeModule, SubscriptionsModule, CommandQueueModule, …) just to
 * reach EscPosBuilderRegistry. DeviceMeshModule still imports this module
 * and re-exports both tokens, so its existing consumers (print
 * orchestration, delivery-platforms) are unaffected.
 */
@Global()
@Module({
  providers: [
    EscPosBuilderRegistry,
    EscPosBuilderService,
    EscPosBuilderUzService,
  ],
  exports: [
    EscPosBuilderRegistry,
    EscPosBuilderService,
    EscPosBuilderUzService,
  ],
})
export class PrintingCoreModule {}
