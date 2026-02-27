export enum StockUnit {
  KG = 'KG',
  G = 'G',
  L = 'L',
  ML = 'ML',
  PCS = 'PCS',
  BOX = 'BOX',
  BAG = 'BAG',
  CAN = 'CAN',
  BOTTLE = 'BOTTLE',
  BUNCH = 'BUNCH',
  SLICE = 'SLICE',
  PORTION = 'PORTION',
}

export enum IngredientMovementType {
  IN = 'IN',
  OUT = 'OUT',
  ADJUSTMENT = 'ADJUSTMENT',
  WASTE = 'WASTE',
  ORDER_DEDUCTION = 'ORDER_DEDUCTION',
  PO_RECEIVE = 'PO_RECEIVE',
  COUNT_ADJUSTMENT = 'COUNT_ADJUSTMENT',
}

export enum PurchaseOrderStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  PARTIALLY_RECEIVED = 'PARTIALLY_RECEIVED',
  RECEIVED = 'RECEIVED',
  CANCELLED = 'CANCELLED',
}

export enum WasteReason {
  EXPIRED = 'EXPIRED',
  SPOILED = 'SPOILED',
  DAMAGED = 'DAMAGED',
  OVERPRODUCTION = 'OVERPRODUCTION',
  PREPARATION_WASTE = 'PREPARATION_WASTE',
  CUSTOMER_RETURN = 'CUSTOMER_RETURN',
  OTHER = 'OTHER',
}

export enum StockCountStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export interface StockItemCategory {
  id: string;
  name: string;
  description?: string;
  color?: string;
  _count?: { stockItems: number };
  createdAt: string;
  updatedAt: string;
}

export interface StockItem {
  id: string;
  name: string;
  sku?: string;
  unit: StockUnit;
  description?: string;
  currentStock: number;
  minStock: number;
  costPerUnit: number;
  trackExpiry: boolean;
  isActive: boolean;
  categoryId?: string;
  category?: StockItemCategory;
  batches?: StockBatch[];
  supplierStockItems?: SupplierStockItem[];
  createdAt: string;
  updatedAt: string;
}

export interface StockBatch {
  id: string;
  batchNumber?: string;
  quantity: number;
  costPerUnit: number;
  receivedAt: string;
  expiryDate?: string;
  stockItemId: string;
  stockItem?: { id: string; name: string; unit: string };
}

export interface Recipe {
  id: string;
  name?: string;
  notes?: string;
  yield: number;
  productId: string;
  product?: { id: string; name: string; price: number };
  ingredients: RecipeIngredient[];
  createdAt: string;
  updatedAt: string;
}

export interface RecipeIngredient {
  id: string;
  quantity: number;
  recipeId: string;
  stockItemId: string;
  stockItem?: { id: string; name: string; unit: string; currentStock: number; costPerUnit?: number };
}

export interface Supplier {
  id: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  paymentTerms?: string;
  notes?: string;
  isActive: boolean;
  supplierStockItems?: SupplierStockItem[];
  _count?: { supplierStockItems: number; purchaseOrders: number };
  createdAt: string;
  updatedAt: string;
}

export interface SupplierStockItem {
  id: string;
  supplierSku?: string;
  unitPrice: number;
  isPreferred: boolean;
  supplierId: string;
  supplier?: { id: string; name: string };
  stockItemId: string;
  stockItem?: { id: string; name: string; unit: string };
}

export interface PurchaseOrder {
  id: string;
  orderNumber: string;
  status: PurchaseOrderStatus;
  notes?: string;
  expectedDate?: string;
  supplierId: string;
  supplier?: { id: string; name: string };
  items: PurchaseOrderItem[];
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  receivedAt?: string;
}

export interface PurchaseOrderItem {
  id: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitPrice: number;
  stockItemId: string;
  stockItem?: { id: string; name: string; unit: string };
}

export interface IngredientMovement {
  id: string;
  type: IngredientMovementType;
  quantity: number;
  costPerUnit?: number;
  notes?: string;
  referenceType?: string;
  referenceId?: string;
  stockItemId: string;
  stockItem?: { id: string; name: string; unit: string };
  createdAt: string;
}

export interface WasteLog {
  id: string;
  quantity: number;
  reason: WasteReason;
  notes?: string;
  cost?: number;
  stockItemId: string;
  stockItem?: { id: string; name: string; unit: string };
  createdAt: string;
}

export interface StockCount {
  id: string;
  name?: string;
  status: StockCountStatus;
  notes?: string;
  items: StockCountItem[];
  _count?: { items: number };
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface StockCountItem {
  id: string;
  expectedQty: number;
  countedQty?: number;
  variance?: number;
  stockItemId: string;
  stockItem?: { id: string; name: string; unit: string; currentStock: number };
}

export interface StockSettings {
  id: string;
  tenantId: string;
  enableAutoDeduction: boolean;
  deductOnStatus: string;
  lowStockAlertDays: number;
  poNumberPrefix: string;
}

export interface StockDashboard {
  totalItems: number;
  activeItems: number;
  lowStockCount: number;
  lowStockItems: any[];
  expiringBatchCount: number;
  expiringBatches: StockBatch[];
  recentMovements: IngredientMovement[];
  wasteLast30Days: { totalCost: number; count: number };
  pendingPurchaseOrders: number;
}

export interface StockValuation {
  totalValue: number;
  itemCount: number;
  items: (StockItem & { totalValue: number })[];
}

export interface StockCheckResult {
  canProduce: boolean;
  maxQuantity: number;
  ingredients: {
    stockItemId: string;
    name: string;
    unit: string;
    required: number;
    available: number;
    sufficient: boolean;
    shortage: number;
  }[];
}
