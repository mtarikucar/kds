export enum IntegrationType {
  PAYMENT_GATEWAY = 'PAYMENT_GATEWAY',
  POS_HARDWARE = 'POS_HARDWARE',
  THIRD_PARTY_API = 'THIRD_PARTY_API',
  DELIVERY_APP = 'DELIVERY_APP',
  ACCOUNTING = 'ACCOUNTING',
  CRM = 'CRM',
  INVENTORY = 'INVENTORY',
  // Hardware Device Types
  THERMAL_PRINTER = 'THERMAL_PRINTER',
  CASH_DRAWER = 'CASH_DRAWER',
  RESTAURANT_PAGER = 'RESTAURANT_PAGER',
  BARCODE_READER = 'BARCODE_READER',
  CUSTOMER_DISPLAY = 'CUSTOMER_DISPLAY',
  KITCHEN_DISPLAY = 'KITCHEN_DISPLAY',
  SCALE_DEVICE = 'SCALE_DEVICE',
}

export const IntegrationTypeLabels: Record<IntegrationType, string> = {
  [IntegrationType.PAYMENT_GATEWAY]: 'Payment Gateway',
  [IntegrationType.POS_HARDWARE]: 'POS Hardware',
  [IntegrationType.THIRD_PARTY_API]: 'Third Party API',
  [IntegrationType.DELIVERY_APP]: 'Delivery App',
  [IntegrationType.ACCOUNTING]: 'Accounting',
  [IntegrationType.CRM]: 'CRM',
  [IntegrationType.INVENTORY]: 'Inventory',
  [IntegrationType.THERMAL_PRINTER]: 'Thermal Printer',
  [IntegrationType.CASH_DRAWER]: 'Cash Drawer',
  [IntegrationType.RESTAURANT_PAGER]: 'Restaurant Pager',
  [IntegrationType.BARCODE_READER]: 'Barcode Reader',
  [IntegrationType.CUSTOMER_DISPLAY]: 'Customer Display',
  [IntegrationType.KITCHEN_DISPLAY]: 'Kitchen Display',
  [IntegrationType.SCALE_DEVICE]: 'Scale Device',
};
