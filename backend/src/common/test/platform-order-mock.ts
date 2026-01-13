import { PlatformType, PlatformOrderStatus } from '../../modules/order-integrations/constants';
import { WebhookEventType, WebhookReceivedEvent } from '../../modules/kafka/interfaces/kafka-event.interface';

/**
 * Mock platform order data
 */
export const mockPlatformOrder = {
  id: 'platform-order-1',
  tenantId: 'tenant-1',
  platformType: 'GETIR' as PlatformType,
  platformOrderId: 'getir-12345',
  platformOrderNumber: 'GY-001',
  platformStatus: 'NEW' as PlatformOrderStatus,
  internalStatus: 'RECEIVED' as PlatformOrderStatus,
  orderId: null as string | null,
  rawOrderData: {},
  customerInfo: {
    name: 'John Doe',
    phone: '+905551234567',
  },
  deliveryInfo: {
    address: '123 Test Street, Istanbul',
    latitude: 41.0082,
    longitude: 28.9784,
  },
  paymentInfo: {
    method: 'ONLINE_CARD',
    isPrepaid: true,
    total: 99.99,
  },
  platformTotal: 99.99,
  items: [] as unknown[],
  createdAt: new Date('2024-01-01T12:00:00Z'),
  updatedAt: new Date('2024-01-01T12:00:00Z'),
};

/**
 * Mock platform order item
 */
export const mockPlatformOrderItem = {
  id: 'platform-order-item-1',
  platformOrderId: 'platform-order-1',
  platformProductId: 'platform-product-1',
  productId: 'product-1',
  name: 'Test Product',
  quantity: 2,
  unitPrice: 25.0,
  totalPrice: 50.0,
  notes: 'Extra sauce',
  options: [],
};

/**
 * Mock webhook payload from Getir
 */
export const mockGetirWebhookPayload = {
  id: 'getir-12345',
  status: 1, // New order
  orderNo: 'GY-001',
  totalPrice: 9999, // in kuruş
  clientName: 'John Doe',
  clientPhoneNumber: '+905551234567',
  clientDeliveryAddress: {
    address: '123 Test Street, Istanbul',
    latitude: 41.0082,
    longitude: 28.9784,
  },
  products: [
    {
      id: 'getir-product-1',
      name: 'Test Product',
      count: 2,
      priceWithoutOption: 2500,
      price: 5000,
      optionPrice: 0,
    },
  ],
  createdDate: '2024-01-01T12:00:00.000Z',
  paymentMethodId: 1, // Online card
  isScheduled: false,
};

/**
 * Mock webhook payload from Trendyol
 */
export const mockTrendyolWebhookPayload = {
  id: 'trendyol-12345',
  orderNumber: 'TY-001',
  status: 'Created',
  totalPrice: 99.99,
  customerFirstName: 'John',
  customerLastName: 'Doe',
  customerAddress: '123 Test Street, Istanbul',
  lines: [
    {
      productId: 123456,
      barcode: '8680000000001',
      productName: 'Test Product',
      quantity: 2,
      price: 25.0,
      amount: 50.0,
    },
  ],
  packageHistories: [],
  cargoTrackingNumber: null,
  cargoProviderName: null,
};

/**
 * Mock webhook payload from Yemeksepeti
 */
export const mockYemeksepetiWebhookPayload = {
  orderId: 'yemeksepeti-12345',
  orderCode: 'YS-001',
  status: 'pending',
  totalAmount: 99.99,
  customer: {
    name: 'John Doe',
    phone: '+905551234567',
  },
  deliveryAddress: {
    fullAddress: '123 Test Street, Istanbul',
    latitude: 41.0082,
    longitude: 28.9784,
  },
  items: [
    {
      productId: 'ys-product-1',
      name: 'Test Product',
      quantity: 2,
      unitPrice: 25.0,
      totalPrice: 50.0,
    },
  ],
  paymentMethod: 'online',
  isPaid: true,
};

/**
 * Mock webhook received event for Kafka processing
 */
export function mockWebhookReceivedEvent(
  overrides?: Partial<WebhookReceivedEvent>,
): WebhookReceivedEvent {
  return {
    platformType: 'GETIR' as PlatformType,
    platformOrderId: 'getir-12345',
    webhookType: 'ORDER_CREATED' as WebhookEventType,
    rawPayload: mockGetirWebhookPayload,
    headers: {
      'x-getir-signature': 'test-signature',
      'content-type': 'application/json',
    },
    receivedAt: new Date('2024-01-01T12:00:00Z'),
    ...overrides,
  };
}

/**
 * Mock integration settings
 */
export const mockIntegrationSettings = {
  id: 'integration-settings-1',
  tenantId: 'tenant-1',
  platformType: 'GETIR' as PlatformType,
  isEnabled: true,
  autoAccept: false,
  enablePolling: false,
  apiKey: 'test-api-key',
  apiSecret: 'test-api-secret',
  restaurantId: 'restaurant-123',
  webhookSecret: 'webhook-secret',
  settings: {},
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

/**
 * Mock product mapping
 */
export const mockProductMapping = {
  id: 'mapping-1',
  tenantId: 'tenant-1',
  platformType: 'GETIR' as PlatformType,
  platformProductId: 'getir-product-1',
  productId: 'product-1',
  platformProductName: 'Getir Product Name',
  isActive: true,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

/**
 * Create mock platform order with custom overrides
 */
export function createMockPlatformOrder(overrides?: Partial<typeof mockPlatformOrder>) {
  return {
    ...mockPlatformOrder,
    ...overrides,
  };
}

/**
 * Create mock webhook event for Kafka
 */
export function createMockWebhookEvent(
  webhookType: WebhookEventType = 'ORDER_CREATED',
  platformType: PlatformType = PlatformType.GETIR,
) {
  const payloads = {
    GETIR: mockGetirWebhookPayload,
    TRENDYOL: mockTrendyolWebhookPayload,
    YEMEKSEPETI: mockYemeksepetiWebhookPayload,
    MIGROS: mockGetirWebhookPayload, // Use Getir as template
    FUUDY: mockYemeksepetiWebhookPayload, // Use Yemeksepeti as template
  };

  return mockWebhookReceivedEvent({
    platformType,
    webhookType,
    rawPayload: payloads[platformType] || mockGetirWebhookPayload,
    platformOrderId: `${platformType.toLowerCase()}-12345`,
  });
}
