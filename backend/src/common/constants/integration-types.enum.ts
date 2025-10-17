export enum IntegrationType {
  PAYMENT_GATEWAY = 'PAYMENT_GATEWAY',
  POS_HARDWARE = 'POS_HARDWARE',
  THIRD_PARTY_API = 'THIRD_PARTY_API',
  DELIVERY_APP = 'DELIVERY_APP',
  ACCOUNTING = 'ACCOUNTING',
  CRM = 'CRM',
  INVENTORY = 'INVENTORY',
}

export const IntegrationTypeLabels: Record<IntegrationType, string> = {
  [IntegrationType.PAYMENT_GATEWAY]: 'Payment Gateway',
  [IntegrationType.POS_HARDWARE]: 'POS Hardware',
  [IntegrationType.THIRD_PARTY_API]: 'Third Party API',
  [IntegrationType.DELIVERY_APP]: 'Delivery App',
  [IntegrationType.ACCOUNTING]: 'Accounting',
  [IntegrationType.CRM]: 'CRM',
  [IntegrationType.INVENTORY]: 'Inventory',
};
