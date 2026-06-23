import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { EscPosBuilder } from "./escpos.types";

/**
 * Registry of ESC/POS byte-builders, keyed by `id`. Mirrors
 * FiscalProviderRegistry: the concrete builder self-registers in its
 * onModuleInit() so callers (print orchestration / device-mesh command
 * enqueue) resolve a builder by dialect id rather than wiring a concrete class.
 */
@Injectable()
export class EscPosBuilderRegistry {
  private readonly logger = new Logger(EscPosBuilderRegistry.name);
  private readonly builders = new Map<string, EscPosBuilder>();

  register(builder: EscPosBuilder): void {
    this.builders.set(builder.id, builder);
    this.logger.log(`Registered EscPosBuilder: ${builder.id}`);
  }

  get(id: string): EscPosBuilder {
    const b = this.builders.get(id);
    if (!b) throw new NotFoundException(`Unknown ESC/POS builder: ${id}`);
    return b;
  }

  list(): EscPosBuilder[] {
    return [...this.builders.values()];
  }
}
