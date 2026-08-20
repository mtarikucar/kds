import { Global, Module } from "@nestjs/common";
import { SmsProviderRegistry } from "./sms-provider.registry";
import { NetGsmProvider } from "./adapters/netgsm.provider";
import { TwilioProvider } from "./adapters/twilio.provider";

/**
 * SMS-core module. Mirrors payments-core / fiscal-core / printing-core: a
 * small @Global() module whose only job is to hold a registry and the
 * concrete adapters that self-register into it at boot (NetGsmProvider /
 * TwilioProvider register in their own onModuleInit(), conditional on
 * having real credentials).
 *
 * Task 11 (SMS: process-once -> per-tenant). SmsService (customers module)
 * used to construct a NetGsmProvider/TwilioProvider directly and pick ONE
 * for the life of the process. It now injects SmsProviderRegistry (ambient,
 * via this module's @Global() status — no explicit import needed) and
 * resolves a provider per send() call via
 * CountryCapabilityResolver.smsProviderIdFor(tenantId).
 *
 * Only SmsProviderRegistry is exported — NetGsmProvider/TwilioProvider are
 * internal to this module; nothing outside it should construct or inject a
 * vendor class directly, same posture as PaymentProviderRegistry /
 * FiscalProviderRegistry.
 */
@Global()
@Module({
  providers: [SmsProviderRegistry, NetGsmProvider, TwilioProvider],
  exports: [SmsProviderRegistry],
})
export class SmsCoreModule {}
