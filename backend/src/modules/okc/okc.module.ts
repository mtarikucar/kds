import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { OkcController } from "./okc.controller";
import { OkcService } from "./okc.service";
import { FiscalReceiptGenerator } from "./fiscal-receipt.generator";
import {
  OKC_DEVICE,
  MockOkcDevice,
  NullOkcDevice,
} from "./okc-device.provider";

/**
 * ÖKC (yeni nesil yazarkasa) fiscal receipts. The device is selected under the
 * OKC_DEVICE token: OKC_PROVIDER=mock uses the in-memory device (dev/test);
 * anything else defaults to NullOkcDevice, which refuses to print until a real
 * SDK-backed provider is installed. Everything else — receipt generation, the
 * print flow — is code-complete and tested.
 */
@Module({
  imports: [PrismaModule],
  controllers: [OkcController],
  providers: [
    OkcService,
    FiscalReceiptGenerator,
    {
      provide: OKC_DEVICE,
      useFactory: () =>
        process.env.OKC_PROVIDER === "mock"
          ? new MockOkcDevice()
          : new NullOkcDevice(),
    },
  ],
  exports: [OkcService],
})
export class OkcModule {}
