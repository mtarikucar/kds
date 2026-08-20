export interface SmsSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * `name` doubles as the SmsProviderRegistry key (there is no separate `id`
 * field, unlike PaymentProvider/FiscalProvider/EscPosBuilder) — NetGSM and
 * Twilio already named themselves "netgsm"/"twilio" before Task 11 existed,
 * which happen to be exactly the two strings the SMS_PROVIDER env var has
 * always accepted. Reusing `name` keeps that operator-facing contract
 * unchanged rather than introducing a second, redundant identifier.
 */
export interface SmsProvider {
  readonly name: string;
  send(to: string, message: string): Promise<SmsSendResult>;
  isConfigured(): boolean;
}
