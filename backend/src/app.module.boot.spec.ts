import { Test } from "@nestjs/testing";
import { AppModule } from "./app.module";

/**
 * Boot smoke-test: build the FULL AppModule DI graph.
 *
 * Isolated per-module TestingModules (the norm elsewhere) never assemble the
 * whole graph, so a circular / undefined module import — e.g. two modules that
 * import each other without forwardRef — sails through the unit suite and only
 * explodes at `NestFactory.create(AppModule)` in production
 * (UndefinedModuleException → process exit). This test compiles the real graph
 * so that class of bug fails CI, not prod.
 *
 * `.compile()` performs module scanning + provider instantiation (which is where
 * the cycle is detected) but does NOT run onModuleInit hooks, so no DB/network
 * connection is opened.
 */
describe("AppModule bootstrap (module graph)", () => {
  it("assembles the whole module graph without a circular/undefined import", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
