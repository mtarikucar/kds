# Muhasebe Entegrasyonu (KDV + Fatura + Paraşüt + e-Fatura + Logo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restoran siparişlerinde KDV hesabı, satış faturası oluşturma, Paraşüt/Logo muhasebe yazılımı senkronizasyonu ve e-Fatura/e-Arşiv entegrasyonu eklemek.

**Architecture:** 5 fazlı modüler yapı. Faz 1 KDV altyapısını kurar, Faz 2 dahili satış faturası modeli oluşturur, Faz 3-5 dış entegrasyonları (Paraşüt, e-Fatura, Logo) adapter pattern ile ekler. Her faz bağımsız çalışır ve test edilebilir.

**Tech Stack:** NestJS, Prisma, PostgreSQL, axios (HTTP client), Paraşüt REST API (OAuth2), Foriba/Sovos e-Fatura API, Logo REST API. Frontend: React, TanStack Query, Tailwind.

---

## File Structure

### Backend - New Files
```
src/modules/accounting/
├── accounting.module.ts
├── constants/
│   └── accounting.enum.ts                    # Tax rates, invoice statuses, provider types
├── dto/
│   ├── create-sales-invoice.dto.ts
│   └── accounting-settings.dto.ts
├── services/
│   ├── tax-calculation.service.ts            # KDV hesaplama
│   ├── sales-invoice.service.ts              # Satış faturası CRUD + PDF
│   ├── accounting-settings.service.ts        # Per-tenant muhasebe ayarları
│   └── accounting-sync.service.ts            # Dış sistemlere senkronizasyon orkestratörü
├── adapters/
│   ├── accounting-adapter.interface.ts       # Ortak adapter arayüzü
│   ├── parasut.adapter.ts                    # Paraşüt REST API
│   ├── logo.adapter.ts                       # Logo REST API
│   └── foriba-efatura.adapter.ts             # Foriba/Sovos e-Fatura API
├── controllers/
│   ├── sales-invoice.controller.ts
│   └── accounting-settings.controller.ts
```

### Backend - Modified Files
```
prisma/schema.prisma                          # Product.taxRate, SalesInvoice model, AccountingSettings model
src/modules/orders/services/orders.service.ts # KDV hesaplama eklenir
src/modules/orders/services/payments.service.ts # Fatura oluşturma tetiklenir
src/modules/z-reports/z-reports.service.ts    # KDV dağılımı eklenir
src/app.module.ts                             # AccountingModule register
```

### Frontend - New Files
```
src/features/accounting/
├── accountingApi.ts                          # API hooks
├── types.ts                                  # TypeScript interfaces
src/pages/settings/AccountingSettingsPage.tsx  # Muhasebe ayarları UI
src/pages/admin/invoices/InvoicesPage.tsx      # Fatura listesi
src/pages/admin/invoices/InvoiceDetailPage.tsx # Fatura detay
```

### Frontend - Modified Files
```
src/App.tsx                                   # Routes
src/pages/settings/SettingsLayout.tsx          # Nav item
src/components/layout/Sidebar.tsx              # Ana menüye fatura linki
src/i18n/locales/{tr,en,ru,ar,uz}/settings.json
src/i18n/locales/{tr,en}/accounting.json (new)
```

---

## FAZ 1: KDV/VERGİ ALTYAPISI

### Task 1: Vergi sabitleri ve hesaplama servisi

**Files:**
- Create: `backend/src/modules/accounting/constants/accounting.enum.ts`
- Create: `backend/src/modules/accounting/services/tax-calculation.service.ts`

- [ ] **Step 1: Create accounting enum constants**

```typescript
// backend/src/modules/accounting/constants/accounting.enum.ts
export enum TaxRate {
  ZERO = 0,
  ONE = 1,
  TEN = 10,
  TWENTY = 20,
}

export const DEFAULT_TAX_RATE = TaxRate.TEN;

export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  ISSUED = 'ISSUED',
  SENT = 'SENT',
  CANCELLED = 'CANCELLED',
}

export enum AccountingProvider {
  NONE = 'NONE',
  PARASUT = 'PARASUT',
  LOGO = 'LOGO',
  FORIBA = 'FORIBA',
}

export enum InvoiceType {
  SALES = 'SALES',
  REFUND = 'REFUND',
}
```

- [ ] **Step 2: Create tax calculation service**

```typescript
// backend/src/modules/accounting/services/tax-calculation.service.ts
import { Injectable } from '@nestjs/common';

export interface TaxBreakdown {
  subtotalExcludingTax: number;
  taxAmount: number;
  totalIncludingTax: number;
  taxRate: number;
}

export interface OrderTaxSummary {
  items: Array<{
    productId: string;
    quantity: number;
    unitPriceExcTax: number;
    taxRate: number;
    taxAmount: number;
    subtotalIncTax: number;
  }>;
  taxBreakdown: Record<number, { taxableAmount: number; taxAmount: number }>;
  totalExcTax: number;
  totalTax: number;
  totalIncTax: number;
}

@Injectable()
export class TaxCalculationService {
  /**
   * Product prices are stored INCLUDING tax (KDV dahil).
   * This extracts the tax component from an inclusive price.
   */
  extractTax(priceIncTax: number, taxRatePercent: number): TaxBreakdown {
    const rate = taxRatePercent / 100;
    const subtotalExcludingTax = priceIncTax / (1 + rate);
    const taxAmount = priceIncTax - subtotalExcludingTax;

    return {
      subtotalExcludingTax: Math.round(subtotalExcludingTax * 100) / 100,
      taxAmount: Math.round(taxAmount * 100) / 100,
      totalIncludingTax: priceIncTax,
      taxRate: taxRatePercent,
    };
  }

  /**
   * Calculate tax summary for an entire order.
   * Each item uses its product's tax rate.
   */
  calculateOrderTax(
    items: Array<{
      productId: string;
      quantity: number;
      unitPriceIncTax: number;
      modifierTotalIncTax: number;
      taxRate: number;
    }>,
  ): OrderTaxSummary {
    const taxBreakdown: Record<number, { taxableAmount: number; taxAmount: number }> = {};
    let totalExcTax = 0;
    let totalTax = 0;
    let totalIncTax = 0;

    const itemResults = items.map((item) => {
      const lineTotal = item.quantity * (item.unitPriceIncTax + item.modifierTotalIncTax);
      const tax = this.extractTax(lineTotal, item.taxRate);

      if (!taxBreakdown[item.taxRate]) {
        taxBreakdown[item.taxRate] = { taxableAmount: 0, taxAmount: 0 };
      }
      taxBreakdown[item.taxRate].taxableAmount += tax.subtotalExcludingTax;
      taxBreakdown[item.taxRate].taxAmount += tax.taxAmount;

      totalExcTax += tax.subtotalExcludingTax;
      totalTax += tax.taxAmount;
      totalIncTax += lineTotal;

      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPriceExcTax: Math.round((item.unitPriceIncTax / (1 + item.taxRate / 100)) * 100) / 100,
        taxRate: item.taxRate,
        taxAmount: tax.taxAmount,
        subtotalIncTax: lineTotal,
      };
    });

    return {
      items: itemResults,
      taxBreakdown,
      totalExcTax: Math.round(totalExcTax * 100) / 100,
      totalTax: Math.round(totalTax * 100) / 100,
      totalIncTax: Math.round(totalIncTax * 100) / 100,
    };
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/accounting/
git commit -m "feat(accounting): add tax calculation service and accounting enums"
```

---

### Task 2: Product modeline taxRate alanı ekle

**Files:**
- Modify: `backend/prisma/schema.prisma` (Product model, ~line 225)

- [ ] **Step 1: Add taxRate to Product model**

In `schema.prisma`, inside the `Product` model, after `displayOrder Int @default(0)`:

```prisma
  taxRate      Int     @default(10) // KDV rate: 0, 1, 10, 20
```

- [ ] **Step 2: Run prisma db push**

```bash
cd backend && npx prisma db push
```
Expected: `Your database is now in sync with your Prisma schema`

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/schema.prisma
git commit -m "feat(accounting): add taxRate field to Product model (default 10% KDV)"
```

---

### Task 3: Order ve OrderItem modellerine vergi alanları ekle

**Files:**
- Modify: `backend/prisma/schema.prisma` (Order model ~line 434, OrderItem model ~line 494)

- [ ] **Step 1: Add tax fields to Order model**

In `schema.prisma`, inside `Order` model, after `finalAmount`:

```prisma
  taxAmount    Decimal @default(0) @db.Decimal(10, 2)
```

- [ ] **Step 2: Add tax fields to OrderItem model**

In `schema.prisma`, inside `OrderItem` model, after `modifierTotal`:

```prisma
  taxRate       Int     @default(10)
  taxAmount     Decimal @default(0) @db.Decimal(10, 2)
```

- [ ] **Step 3: Run prisma db push**

```bash
cd backend && npx prisma db push
```

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma
git commit -m "feat(accounting): add taxAmount to Order and OrderItem models"
```

---

### Task 4: Sipariş oluşturma akışına KDV hesaplama entegre et

**Files:**
- Modify: `backend/src/modules/orders/services/orders.service.ts` (~line 133-166)
- Modify: `backend/src/modules/orders/orders.module.ts`

- [ ] **Step 1: Import TaxCalculationService in OrdersModule**

In `orders.module.ts`, add `AccountingModule` to imports (will be created in next step).

For now, directly provide `TaxCalculationService`:

```typescript
// orders.module.ts - add to imports
import { AccountingModule } from '../accounting/accounting.module';

// In @Module imports array, add:
AccountingModule,
```

- [ ] **Step 2: Create minimal AccountingModule**

```typescript
// backend/src/modules/accounting/accounting.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TaxCalculationService } from './services/tax-calculation.service';

@Module({
  imports: [PrismaModule],
  providers: [TaxCalculationService],
  exports: [TaxCalculationService],
})
export class AccountingModule {}
```

- [ ] **Step 3: Inject TaxCalculationService into OrdersService**

In `orders.service.ts`, add to constructor:

```typescript
import { TaxCalculationService } from '../../accounting/services/tax-calculation.service';

// In constructor, add after stockDeductionService:
@Optional()
private taxCalculationService?: TaxCalculationService,
```

- [ ] **Step 4: Modify order creation calculation (lines 133-166)**

Replace the existing total calculation block with tax-aware version. The key change: each `OrderItem` now includes `taxRate` and `taxAmount`.

Find the block that starts with `let totalAmount = 0;` and ends with `const finalAmount = totalAmount - discount;`. Replace it:

```typescript
      // Calculate order items with tax
      let totalAmount = 0;
      let totalTaxAmount = 0;
      const orderItems = createOrderDto.items.map((item) => {
        const product = productMap.get(item.productId);
        const serverPrice = Number(product?.price ?? 0);
        const taxRate = product?.taxRate ?? 10;

        // Calculate modifier total for this item
        let modifierTotal = 0;
        const itemModifiers = (item.modifiers || []).map((mod) => {
          const modifier = modifierMap.get(mod.modifierId);
          const priceAdjustment = Number(modifier?.priceAdjustment || 0);
          modifierTotal += priceAdjustment * mod.quantity;
          return {
            modifierId: mod.modifierId,
            quantity: mod.quantity,
            priceAdjustment,
          };
        });

        const subtotal = item.quantity * (serverPrice + modifierTotal);
        totalAmount += subtotal;

        // Calculate tax for this line item (prices are KDV-inclusive)
        let itemTaxAmount = 0;
        if (this.taxCalculationService) {
          const tax = this.taxCalculationService.extractTax(subtotal, taxRate);
          itemTaxAmount = tax.taxAmount;
          totalTaxAmount += itemTaxAmount;
        }

        return {
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: serverPrice,
          subtotal,
          modifierTotal,
          taxRate,
          taxAmount: itemTaxAmount,
          notes: item.notes,
          modifiers: itemModifiers.length > 0 ? { create: itemModifiers } : undefined,
        };
      });

      const discount = createOrderDto.discount || 0;
      const finalAmount = totalAmount - discount;
      
      // Recalculate tax after discount (proportional)
      const discountRatio = totalAmount > 0 ? discount / totalAmount : 0;
      const adjustedTaxAmount = Math.round(totalTaxAmount * (1 - discountRatio) * 100) / 100;
```

- [ ] **Step 5: Add taxAmount to order create data**

In the same `create()` method, find `data: { orderNumber, type, ...}` and add `taxAmount: adjustedTaxAmount` field.

- [ ] **Step 6: Register AccountingModule in AppModule**

In `app.module.ts`:
```typescript
import { AccountingModule } from './modules/accounting/accounting.module';
// Add to imports array
AccountingModule,
```

- [ ] **Step 7: Also need to include product in the product fetch**

In the `create()` method, find the product query (around line 75). Ensure `taxRate` is selected. Since it uses `findMany` with `select`, add `taxRate: true` to the select, or store the full product in the map.

Find where `productPriceMap` is built and change it to also store `taxRate`. The existing code likely does:
```typescript
const productPriceMap = new Map(products.map(p => [p.id, Number(p.price)]));
```

Change to use a `productMap` that stores both price and taxRate:
```typescript
const productMap = new Map(products.map(p => [p.id, p]));
```

And access price via `Number(product?.price ?? 0)` instead of `productPriceMap.get(item.productId)`.

- [ ] **Step 8: Build and verify**

```bash
cd backend && npm run build
```
Expected: `compiled successfully`

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/accounting/ backend/src/modules/orders/ backend/src/app.module.ts
git commit -m "feat(accounting): integrate tax calculation into order creation flow"
```

---

### Task 5: Z-Raporu'na KDV dağılımı ekle

**Files:**
- Modify: `backend/prisma/schema.prisma` (ZReport model)
- Modify: `backend/src/modules/z-reports/z-reports.service.ts`

- [ ] **Step 1: Add taxBreakdown to ZReport model**

In `schema.prisma`, inside `ZReport` model, after `netSales`:

```prisma
  totalTax        Decimal @default(0) @db.Decimal(10, 2)
  taxBreakdown    Json?   // {10: {taxableAmount, taxAmount}, 20: {...}}
```

- [ ] **Step 2: Run prisma db push**

```bash
cd backend && npx prisma db push
```

- [ ] **Step 3: Add tax calculation to Z-Report generation**

In `z-reports.service.ts`, in the `generateReport` method, after `netSales` calculation, add:

```typescript
    // Tax breakdown from order items
    const allOrderItems = orders.flatMap(o => o.orderItems);
    const taxBreakdownMap: Record<number, { taxableAmount: number; taxAmount: number }> = {};
    let totalTax = 0;

    for (const item of allOrderItems) {
      const rate = item.taxRate ?? 10;
      const tax = Number(item.taxAmount || 0);
      if (!taxBreakdownMap[rate]) {
        taxBreakdownMap[rate] = { taxableAmount: 0, taxAmount: 0 };
      }
      taxBreakdownMap[rate].taxAmount += tax;
      taxBreakdownMap[rate].taxableAmount += Number(item.subtotal) - tax;
      totalTax += tax;
    }
```

Then add `totalTax` and `taxBreakdown: taxBreakdownMap` to the `data` object in `prisma.zReport.create()`.

Also ensure the order query includes `orderItems` with `taxRate` and `taxAmount` fields (they should come automatically via Prisma include).

- [ ] **Step 4: Build and verify**

```bash
cd backend && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/src/modules/z-reports/
git commit -m "feat(accounting): add KDV tax breakdown to Z-Report"
```

---

## FAZ 2: SATIŞ FATURASI MODELİ

### Task 6: SalesInvoice Prisma modeli

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Add SalesInvoice and SalesInvoiceItem models**

Add after the existing `Invoice` model:

```prisma
// ========================================
// SALES INVOICE (Müşteri Satış Faturası)
// ========================================

model SalesInvoice {
  id             String   @id @default(uuid())
  invoiceNumber  String
  type           String   @default("SALES") // SALES, REFUND
  status         String   @default("DRAFT") // DRAFT, ISSUED, SENT, CANCELLED

  // Customer info
  customerName   String?
  customerPhone  String?
  customerEmail  String?
  customerTaxId  String?  // Vergi no / TC kimlik no
  customerTaxOffice String? // Vergi dairesi

  // Amounts
  subtotal       Decimal  @db.Decimal(10, 2) // KDV hariç toplam
  taxAmount      Decimal  @db.Decimal(10, 2) // Toplam KDV
  totalAmount    Decimal  @db.Decimal(10, 2) // KDV dahil toplam
  discount       Decimal  @default(0) @db.Decimal(10, 2)
  currency       String   @default("TRY")

  // Tax breakdown
  taxBreakdown   Json?    // {10: {taxableAmount, taxAmount}, 20: {...}}

  // Related records
  orderId        String?
  order          Order?   @relation(fields: [orderId], references: [id], onDelete: SetNull)
  paymentMethod  String?  // CASH, CARD, DIGITAL

  // External sync
  externalId     String?  // Paraşüt/Logo ID
  externalProvider String? // PARASUT, LOGO, FORIBA
  externalStatus String?  // Provider-specific status
  syncedAt       DateTime?
  syncError      String?

  // PDF
  pdfUrl         String?

  // Dates
  issueDate      DateTime @default(now())
  dueDate        DateTime?

  // Tenant
  tenantId       String
  tenant         Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  // Relations
  items          SalesInvoiceItem[]

  @@unique([tenantId, invoiceNumber])
  @@index([tenantId])
  @@index([orderId])
  @@index([status])
  @@index([issueDate])
  @@map("sales_invoices")
}

model SalesInvoiceItem {
  id             String   @id @default(uuid())
  description    String
  quantity       Int
  unitPrice      Decimal  @db.Decimal(10, 2) // KDV hariç birim fiyat
  taxRate        Int      @default(10)
  taxAmount      Decimal  @db.Decimal(10, 2)
  subtotal       Decimal  @db.Decimal(10, 2) // KDV hariç satır toplamı
  total          Decimal  @db.Decimal(10, 2) // KDV dahil satır toplamı

  invoiceId      String
  invoice        SalesInvoice @relation(fields: [invoiceId], references: [id], onDelete: Cascade)

  @@index([invoiceId])
  @@map("sales_invoice_items")
}
```

Also add to `Tenant` model relations:
```prisma
  salesInvoices       SalesInvoice[]
```

And add to `Order` model relations:
```prisma
  salesInvoice   SalesInvoice?
```

- [ ] **Step 2: Add AccountingSettings model**

```prisma
model AccountingSettings {
  id        String   @id @default(uuid())
  tenantId  String   @unique
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  // Auto invoice generation
  autoGenerateInvoice  Boolean @default(false)

  // Company info (for invoice header)
  companyName          String?
  companyTaxId         String?  // Vergi no
  companyTaxOffice     String?  // Vergi dairesi
  companyAddress       String?
  companyPhone         String?
  companyEmail         String?

  // Accounting provider
  provider             String  @default("NONE") // NONE, PARASUT, LOGO, FORIBA
  autoSync             Boolean @default(false)

  // Paraşüt credentials
  parasutCompanyId     String?
  parasutClientId      String?
  parasutClientSecret  String?
  parasutUsername       String?
  parasutPassword      String?

  // Logo credentials
  logoApiUrl           String?
  logoUsername          String?
  logoPassword          String?
  logoFirmNumber       String?

  // Foriba/e-Fatura credentials
  foribaApiUrl         String?
  foribaUsername        String?
  foribaPassword       String?
  foribaServiceType    String?  // E_FATURA, E_ARSIV

  // Invoice settings
  invoicePrefix        String  @default("FTR")
  nextInvoiceNumber    Int     @default(1)
  defaultPaymentTermDays Int   @default(0) // 0 = peşin

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([tenantId])
  @@map("accounting_settings")
}
```

Add to `Tenant` model:
```prisma
  accountingSettings  AccountingSettings?
```

- [ ] **Step 3: Run prisma db push**

```bash
cd backend && npx prisma db push
```

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma
git commit -m "feat(accounting): add SalesInvoice, SalesInvoiceItem, AccountingSettings models"
```

---

### Task 7: AccountingSettings service ve controller

**Files:**
- Create: `backend/src/modules/accounting/dto/accounting-settings.dto.ts`
- Create: `backend/src/modules/accounting/services/accounting-settings.service.ts`
- Create: `backend/src/modules/accounting/controllers/accounting-settings.controller.ts`

- [ ] **Step 1: Create DTO**

```typescript
// backend/src/modules/accounting/dto/accounting-settings.dto.ts
import { IsBoolean, IsOptional, IsString, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateAccountingSettingsDto {
  @ApiPropertyOptional() @IsBoolean() @IsOptional() autoGenerateInvoice?: boolean;

  @ApiPropertyOptional() @IsString() @IsOptional() companyName?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() companyTaxId?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() companyTaxOffice?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() companyAddress?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() companyPhone?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() companyEmail?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() provider?: string;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() autoSync?: boolean;

  @ApiPropertyOptional() @IsString() @IsOptional() parasutCompanyId?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() parasutClientId?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() parasutClientSecret?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() parasutUsername?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() parasutPassword?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() logoApiUrl?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() logoUsername?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() logoPassword?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() logoFirmNumber?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() foribaApiUrl?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() foribaUsername?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() foribaPassword?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() foribaServiceType?: string;

  @ApiPropertyOptional() @IsString() @IsOptional() invoicePrefix?: string;
  @ApiPropertyOptional() @IsInt() @Min(1) @IsOptional() nextInvoiceNumber?: number;
  @ApiPropertyOptional() @IsInt() @Min(0) @IsOptional() defaultPaymentTermDays?: number;
}
```

- [ ] **Step 2: Create service (upsert pattern from SmsSettings)**

```typescript
// backend/src/modules/accounting/services/accounting-settings.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { UpdateAccountingSettingsDto } from '../dto/accounting-settings.dto';

@Injectable()
export class AccountingSettingsService {
  constructor(private prisma: PrismaService) {}

  async findByTenant(tenantId: string) {
    return this.prisma.accountingSettings.upsert({
      where: { tenantId },
      update: {},
      create: { tenantId },
    });
  }

  async update(tenantId: string, dto: UpdateAccountingSettingsDto) {
    return this.prisma.accountingSettings.upsert({
      where: { tenantId },
      update: dto,
      create: { tenantId, ...dto },
    });
  }

  /**
   * Strip sensitive credentials before returning to client.
   */
  sanitize(settings: any) {
    const {
      parasutClientSecret, parasutPassword,
      logoPassword, foribaPassword,
      ...safe
    } = settings;
    return {
      ...safe,
      hasParasutCredentials: !!(parasutClientSecret && settings.parasutUsername),
      hasLogoCredentials: !!(logoPassword && settings.logoUsername),
      hasForibaCredentials: !!(foribaPassword && settings.foribaUsername),
    };
  }

  /**
   * Generate next invoice number and increment counter atomically.
   */
  async getNextInvoiceNumber(tenantId: string): Promise<string> {
    const settings = await this.findByTenant(tenantId);
    const prefix = settings.invoicePrefix || 'FTR';
    const num = settings.nextInvoiceNumber || 1;

    await this.prisma.accountingSettings.update({
      where: { tenantId },
      data: { nextInvoiceNumber: num + 1 },
    });

    return `${prefix}-${String(num).padStart(6, '0')}`;
  }
}
```

- [ ] **Step 3: Create controller (PosSettingsController pattern)**

```typescript
// backend/src/modules/accounting/controllers/accounting-settings.controller.ts
import { Controller, Get, Patch, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AccountingSettingsService } from '../services/accounting-settings.service';
import { UpdateAccountingSettingsDto } from '../dto/accounting-settings.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';

@ApiTags('accounting-settings')
@ApiBearerAuth()
@Controller('accounting-settings')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class AccountingSettingsController {
  constructor(private readonly service: AccountingSettingsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async findByTenant(@Request() req) {
    const settings = await this.service.findByTenant(req.tenantId);
    return this.service.sanitize(settings);
  }

  @Patch()
  @Roles(UserRole.ADMIN)
  async update(@Request() req, @Body() dto: UpdateAccountingSettingsDto) {
    const settings = await this.service.update(req.tenantId, dto);
    return this.service.sanitize(settings);
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/accounting/
git commit -m "feat(accounting): add AccountingSettings service and controller"
```

---

### Task 8: SalesInvoice service - fatura oluşturma ve PDF

**Files:**
- Create: `backend/src/modules/accounting/dto/create-sales-invoice.dto.ts`
- Create: `backend/src/modules/accounting/services/sales-invoice.service.ts`
- Create: `backend/src/modules/accounting/controllers/sales-invoice.controller.ts`

- [ ] **Step 1: Create DTO**

```typescript
// backend/src/modules/accounting/dto/create-sales-invoice.dto.ts
import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSalesInvoiceDto {
  @ApiPropertyOptional() @IsString() @IsOptional() orderId?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() customerName?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() customerTaxId?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() customerTaxOffice?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() customerPhone?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() customerEmail?: string;
}

export class InvoiceQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() page?: number;
  @IsOptional() limit?: number;
}
```

- [ ] **Step 2: Create SalesInvoice service**

```typescript
// backend/src/modules/accounting/services/sales-invoice.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccountingSettingsService } from './accounting-settings.service';
import { TaxCalculationService } from './tax-calculation.service';
import { CreateSalesInvoiceDto, InvoiceQueryDto } from '../dto/create-sales-invoice.dto';
import { InvoiceStatus } from '../constants/accounting.enum';

@Injectable()
export class SalesInvoiceService {
  constructor(
    private prisma: PrismaService,
    private settingsService: AccountingSettingsService,
    private taxService: TaxCalculationService,
  ) {}

  async createFromOrder(orderId: string, tenantId: string, dto?: CreateSalesInvoiceDto) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, status: 'PAID' },
      include: {
        orderItems: { include: { product: true } },
        payments: { where: { status: 'COMPLETED' } },
        salesInvoice: true,
      },
    });

    if (!order) throw new NotFoundException('Paid order not found');
    if (order.salesInvoice) throw new BadRequestException('Invoice already exists for this order');

    const invoiceNumber = await this.settingsService.getNextInvoiceNumber(tenantId);
    const settings = await this.settingsService.findByTenant(tenantId);

    // Build invoice items from order items
    const invoiceItems = order.orderItems.map((item) => {
      const lineTotal = Number(item.subtotal);
      const taxRate = item.taxRate ?? 10;
      const tax = this.taxService.extractTax(lineTotal, taxRate);

      return {
        description: item.product?.name || 'Ürün',
        quantity: item.quantity,
        unitPrice: tax.subtotalExcludingTax / item.quantity,
        taxRate,
        taxAmount: tax.taxAmount,
        subtotal: tax.subtotalExcludingTax,
        total: lineTotal,
      };
    });

    const subtotal = invoiceItems.reduce((s, i) => s + i.subtotal, 0);
    const taxAmount = invoiceItems.reduce((s, i) => s + i.taxAmount, 0);
    const totalAmount = Number(order.finalAmount);
    const discount = Number(order.discount);

    // Tax breakdown
    const taxBreakdown: Record<number, { taxableAmount: number; taxAmount: number }> = {};
    for (const item of invoiceItems) {
      if (!taxBreakdown[item.taxRate]) {
        taxBreakdown[item.taxRate] = { taxableAmount: 0, taxAmount: 0 };
      }
      taxBreakdown[item.taxRate].taxableAmount += item.subtotal;
      taxBreakdown[item.taxRate].taxAmount += item.taxAmount;
    }

    const paymentMethod = order.payments[0]?.method || null;

    return this.prisma.salesInvoice.create({
      data: {
        invoiceNumber,
        status: InvoiceStatus.ISSUED,
        customerName: dto?.customerName || order.customerName,
        customerPhone: dto?.customerPhone || order.customerPhone,
        customerEmail: dto?.customerEmail,
        customerTaxId: dto?.customerTaxId,
        customerTaxOffice: dto?.customerTaxOffice,
        subtotal: Math.round(subtotal * 100) / 100,
        taxAmount: Math.round(taxAmount * 100) / 100,
        totalAmount,
        discount,
        taxBreakdown,
        orderId: order.id,
        paymentMethod,
        issueDate: new Date(),
        dueDate: settings.defaultPaymentTermDays > 0
          ? new Date(Date.now() + settings.defaultPaymentTermDays * 86400000)
          : new Date(),
        tenantId,
        items: {
          create: invoiceItems.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: Math.round(item.unitPrice * 100) / 100,
            taxRate: item.taxRate,
            taxAmount: Math.round(item.taxAmount * 100) / 100,
            subtotal: Math.round(item.subtotal * 100) / 100,
            total: Math.round(item.total * 100) / 100,
          })),
        },
      },
      include: { items: true },
    });
  }

  async findAll(tenantId: string, query: InvoiceQueryDto) {
    const where: any = { tenantId };
    if (query.status) where.status = query.status;
    if (query.startDate || query.endDate) {
      where.issueDate = {};
      if (query.startDate) where.issueDate.gte = new Date(query.startDate);
      if (query.endDate) where.issueDate.lte = new Date(query.endDate);
    }
    if (query.search) {
      where.OR = [
        { invoiceNumber: { contains: query.search, mode: 'insensitive' } },
        { customerName: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const page = query.page || 1;
    const limit = query.limit || 20;

    const [items, total] = await Promise.all([
      this.prisma.salesInvoice.findMany({
        where,
        include: { items: true },
        orderBy: { issueDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.salesInvoice.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, tenantId: string) {
    const invoice = await this.prisma.salesInvoice.findFirst({
      where: { id, tenantId },
      include: { items: true, order: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async cancel(id: string, tenantId: string) {
    const invoice = await this.findOne(id, tenantId);
    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException('Invoice already cancelled');
    }
    return this.prisma.salesInvoice.update({
      where: { id },
      data: { status: InvoiceStatus.CANCELLED },
    });
  }
}
```

- [ ] **Step 3: Create SalesInvoice controller**

```typescript
// backend/src/modules/accounting/controllers/sales-invoice.controller.ts
import { Controller, Get, Post, Patch, Param, Query, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SalesInvoiceService } from '../services/sales-invoice.service';
import { CreateSalesInvoiceDto, InvoiceQueryDto } from '../dto/create-sales-invoice.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';

@ApiTags('sales-invoices')
@ApiBearerAuth()
@Controller('sales-invoices')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class SalesInvoiceController {
  constructor(private readonly service: SalesInvoiceService) {}

  @Post('from-order/:orderId')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  createFromOrder(
    @Param('orderId') orderId: string,
    @Request() req,
    @Body() dto: CreateSalesInvoiceDto,
  ) {
    return this.service.createFromOrder(orderId, req.tenantId, dto);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  findAll(@Request() req, @Query() query: InvoiceQueryDto) {
    return this.service.findAll(req.tenantId, query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  findOne(@Param('id') id: string, @Request() req) {
    return this.service.findOne(id, req.tenantId);
  }

  @Patch(':id/cancel')
  @Roles(UserRole.ADMIN)
  cancel(@Param('id') id: string, @Request() req) {
    return this.service.cancel(id, req.tenantId);
  }
}
```

- [ ] **Step 4: Update AccountingModule with new providers**

```typescript
// backend/src/modules/accounting/accounting.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TaxCalculationService } from './services/tax-calculation.service';
import { AccountingSettingsService } from './services/accounting-settings.service';
import { SalesInvoiceService } from './services/sales-invoice.service';
import { AccountingSettingsController } from './controllers/accounting-settings.controller';
import { SalesInvoiceController } from './controllers/sales-invoice.controller';

@Module({
  imports: [PrismaModule],
  controllers: [AccountingSettingsController, SalesInvoiceController],
  providers: [TaxCalculationService, AccountingSettingsService, SalesInvoiceService],
  exports: [TaxCalculationService, AccountingSettingsService, SalesInvoiceService],
})
export class AccountingModule {}
```

- [ ] **Step 5: Build and verify**

```bash
cd backend && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/accounting/
git commit -m "feat(accounting): add SalesInvoice service with order-to-invoice conversion"
```

---

### Task 9: Otomatik fatura oluşturma (ödeme tamamlanınca)

**Files:**
- Modify: `backend/src/modules/orders/services/payments.service.ts`
- Modify: `backend/src/modules/orders/orders.module.ts`

- [ ] **Step 1: Inject SalesInvoiceService into PaymentsService**

In `payments.service.ts`, add to constructor:
```typescript
import { SalesInvoiceService } from '../../accounting/services/sales-invoice.service';
import { AccountingSettingsService } from '../../accounting/services/accounting-settings.service';

// In constructor:
@Optional()
private salesInvoiceService?: SalesInvoiceService,
@Optional()
private accountingSettingsService?: AccountingSettingsService,
```

- [ ] **Step 2: Add auto-invoice after order is marked as PAID**

In the payment `create()` method, after the order is marked as PAID (after `status: OrderStatus.PAID` update), add:

```typescript
      // Auto-generate invoice if enabled
      if (this.salesInvoiceService && this.accountingSettingsService) {
        try {
          const accSettings = await this.accountingSettingsService.findByTenant(tenantId);
          if (accSettings.autoGenerateInvoice) {
            await this.salesInvoiceService.createFromOrder(orderId, tenantId);
          }
        } catch (err) {
          // Fire and forget - don't fail payment because of invoice
          console.error('Auto-invoice generation failed:', err.message);
        }
      }
```

- [ ] **Step 3: Ensure AccountingModule is in OrdersModule imports**

In `orders.module.ts`, `AccountingModule` should already be imported (from Task 4). If not, add it.

- [ ] **Step 4: Build and verify**

```bash
cd backend && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/orders/
git commit -m "feat(accounting): auto-generate sales invoice on order payment"
```

---

## FAZ 3: PARAŞÜT ENTEGRASYONU

### Task 10: Accounting adapter interface ve Paraşüt adapter

**Files:**
- Create: `backend/src/modules/accounting/adapters/accounting-adapter.interface.ts`
- Create: `backend/src/modules/accounting/adapters/parasut.adapter.ts`

- [ ] **Step 1: Create adapter interface**

```typescript
// backend/src/modules/accounting/adapters/accounting-adapter.interface.ts
export interface AccountingInvoiceData {
  invoiceNumber: string;
  issueDate: string;
  dueDate?: string;
  customerName?: string;
  customerTaxId?: string;
  customerTaxOffice?: string;
  currency: string;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
  }>;
  paymentMethod?: string;
  totalAmount: number;
  notes?: string;
}

export interface AccountingAdapter {
  readonly name: string;
  authenticate(credentials: Record<string, string>): Promise<{ accessToken: string; expiresAt?: Date }>;
  pushInvoice(token: string, companyId: string, invoice: AccountingInvoiceData): Promise<{ externalId: string }>;
  testConnection(credentials: Record<string, string>): Promise<boolean>;
}
```

- [ ] **Step 2: Create Paraşüt adapter**

```typescript
// backend/src/modules/accounting/adapters/parasut.adapter.ts
import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { AccountingAdapter, AccountingInvoiceData } from './accounting-adapter.interface';

export class ParasutAdapter implements AccountingAdapter {
  readonly name = 'parasut';
  private readonly logger = new Logger(ParasutAdapter.name);
  private httpClient: AxiosInstance;

  constructor() {
    this.httpClient = axios.create({
      baseURL: 'https://api.parasut.com',
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async authenticate(credentials: Record<string, string>): Promise<{ accessToken: string; expiresAt?: Date }> {
    const response = await this.httpClient.post('/oauth/token', {
      grant_type: 'password',
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      username: credentials.username,
      password: credentials.password,
    });

    const expiresAt = new Date(Date.now() + (response.data.expires_in || 7200) * 1000);
    return { accessToken: response.data.access_token, expiresAt };
  }

  async pushInvoice(token: string, companyId: string, invoice: AccountingInvoiceData): Promise<{ externalId: string }> {
    // First, create or find contact
    let contactId: string | undefined;
    if (invoice.customerName) {
      contactId = await this.findOrCreateContact(token, companyId, {
        name: invoice.customerName,
        taxNumber: invoice.customerTaxId,
        taxOffice: invoice.customerTaxOffice,
      });
    }

    // Create sales invoice
    const invoiceData: any = {
      data: {
        type: 'sales_invoices',
        attributes: {
          item_type: 'invoice',
          description: `Sipariş Faturası - ${invoice.invoiceNumber}`,
          issue_date: invoice.issueDate,
          due_date: invoice.dueDate || invoice.issueDate,
          invoice_series: invoice.invoiceNumber.split('-')[0] || 'FTR',
          invoice_id: parseInt(invoice.invoiceNumber.replace(/\D/g, '')) || 1,
          currency: invoice.currency || 'TRY',
          payment_status: invoice.paymentMethod ? 'paid' : 'unpaid',
        },
        relationships: {},
      },
    };

    if (contactId) {
      invoiceData.data.relationships.contact = {
        data: { id: contactId, type: 'contacts' },
      };
    }

    const response = await this.httpClient.post(
      `/v4/${companyId}/sales_invoices`,
      invoiceData,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    const salesInvoiceId = response.data.data.id;

    // Add line items as details
    for (const item of invoice.items) {
      await this.httpClient.post(
        `/v4/${companyId}/sales_invoices/${salesInvoiceId}/relationships/details`,
        {
          data: {
            type: 'sales_invoice_details',
            attributes: {
              quantity: item.quantity,
              unit_price: item.unitPrice,
              vat_rate: item.taxRate,
              description: item.description,
            },
          },
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );
    }

    this.logger.log(`Paraşüt invoice created: ${salesInvoiceId}`);
    return { externalId: salesInvoiceId };
  }

  async testConnection(credentials: Record<string, string>): Promise<boolean> {
    try {
      await this.authenticate(credentials);
      return true;
    } catch {
      return false;
    }
  }

  private async findOrCreateContact(
    token: string, companyId: string,
    contact: { name: string; taxNumber?: string; taxOffice?: string },
  ): Promise<string> {
    try {
      // Search for existing contact
      const searchResponse = await this.httpClient.get(
        `/v4/${companyId}/contacts?filter[name]=${encodeURIComponent(contact.name)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (searchResponse.data.data?.length > 0) {
        return searchResponse.data.data[0].id;
      }

      // Create new contact
      const createResponse = await this.httpClient.post(
        `/v4/${companyId}/contacts`,
        {
          data: {
            type: 'contacts',
            attributes: {
              name: contact.name,
              contact_type: 'customer',
              tax_number: contact.taxNumber,
              tax_office: contact.taxOffice,
            },
          },
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      return createResponse.data.data.id;
    } catch (err) {
      this.logger.warn(`Contact creation failed: ${err.message}`);
      return undefined;
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/accounting/adapters/
git commit -m "feat(accounting): add Paraşüt adapter with OAuth2 and invoice push"
```

---

### Task 11: Accounting sync service

**Files:**
- Create: `backend/src/modules/accounting/services/accounting-sync.service.ts`

- [ ] **Step 1: Create sync service**

```typescript
// backend/src/modules/accounting/services/accounting-sync.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccountingSettingsService } from './accounting-settings.service';
import { AccountingAdapter, AccountingInvoiceData } from '../adapters/accounting-adapter.interface';
import { ParasutAdapter } from '../adapters/parasut.adapter';
import { AccountingProvider } from '../constants/accounting.enum';

@Injectable()
export class AccountingSyncService {
  private readonly logger = new Logger(AccountingSyncService.name);
  private tokenCache = new Map<string, { token: string; expiresAt: Date }>();

  constructor(
    private prisma: PrismaService,
    private settingsService: AccountingSettingsService,
  ) {}

  async syncInvoice(invoiceId: string, tenantId: string): Promise<void> {
    const settings = await this.settingsService.findByTenant(tenantId);
    if (settings.provider === AccountingProvider.NONE) return;

    const invoice = await this.prisma.salesInvoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: { items: true },
    });
    if (!invoice) return;
    if (invoice.externalId) return; // Already synced

    try {
      const adapter = this.getAdapter(settings.provider);
      if (!adapter) return;

      const token = await this.getToken(tenantId, settings, adapter);
      const companyId = this.getCompanyId(settings);

      const invoiceData: AccountingInvoiceData = {
        invoiceNumber: invoice.invoiceNumber,
        issueDate: invoice.issueDate.toISOString().split('T')[0],
        dueDate: invoice.dueDate?.toISOString().split('T')[0],
        customerName: invoice.customerName || undefined,
        customerTaxId: invoice.customerTaxId || undefined,
        customerTaxOffice: invoice.customerTaxOffice || undefined,
        currency: invoice.currency,
        paymentMethod: invoice.paymentMethod || undefined,
        totalAmount: Number(invoice.totalAmount),
        items: invoice.items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          taxRate: item.taxRate,
        })),
      };

      const result = await adapter.pushInvoice(token, companyId, invoiceData);

      await this.prisma.salesInvoice.update({
        where: { id: invoiceId },
        data: {
          externalId: result.externalId,
          externalProvider: settings.provider,
          externalStatus: 'SYNCED',
          syncedAt: new Date(),
          syncError: null,
        },
      });

      this.logger.log(`Invoice ${invoice.invoiceNumber} synced to ${settings.provider}`);
    } catch (err) {
      this.logger.error(`Sync failed for invoice ${invoiceId}: ${err.message}`);
      await this.prisma.salesInvoice.update({
        where: { id: invoiceId },
        data: {
          syncError: err.message,
          externalStatus: 'FAILED',
        },
      });
    }
  }

  async testConnection(tenantId: string): Promise<{ success: boolean; error?: string }> {
    const settings = await this.settingsService.findByTenant(tenantId);
    const adapter = this.getAdapter(settings.provider);
    if (!adapter) return { success: false, error: 'No provider configured' };

    try {
      const credentials = this.getCredentials(settings);
      const success = await adapter.testConnection(credentials);
      return { success };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  private getAdapter(provider: string): AccountingAdapter | null {
    switch (provider) {
      case AccountingProvider.PARASUT:
        return new ParasutAdapter();
      // Logo and Foriba adapters will be added in later tasks
      default:
        return null;
    }
  }

  private async getToken(tenantId: string, settings: any, adapter: AccountingAdapter): Promise<string> {
    const cached = this.tokenCache.get(tenantId);
    if (cached && cached.expiresAt > new Date()) {
      return cached.token;
    }

    const credentials = this.getCredentials(settings);
    const result = await adapter.authenticate(credentials);
    this.tokenCache.set(tenantId, { token: result.accessToken, expiresAt: result.expiresAt || new Date(Date.now() + 7200000) });
    return result.accessToken;
  }

  private getCredentials(settings: any): Record<string, string> {
    switch (settings.provider) {
      case AccountingProvider.PARASUT:
        return {
          clientId: settings.parasutClientId || '',
          clientSecret: settings.parasutClientSecret || '',
          username: settings.parasutUsername || '',
          password: settings.parasutPassword || '',
        };
      case AccountingProvider.LOGO:
        return {
          apiUrl: settings.logoApiUrl || '',
          username: settings.logoUsername || '',
          password: settings.logoPassword || '',
          firmNumber: settings.logoFirmNumber || '',
        };
      case AccountingProvider.FORIBA:
        return {
          apiUrl: settings.foribaApiUrl || '',
          username: settings.foribaUsername || '',
          password: settings.foribaPassword || '',
        };
      default:
        return {};
    }
  }

  private getCompanyId(settings: any): string {
    switch (settings.provider) {
      case AccountingProvider.PARASUT:
        return settings.parasutCompanyId || '';
      case AccountingProvider.LOGO:
        return settings.logoFirmNumber || '';
      default:
        return '';
    }
  }
}
```

- [ ] **Step 2: Add sync endpoint to accounting-settings controller**

Add to `accounting-settings.controller.ts`:

```typescript
import { AccountingSyncService } from '../services/accounting-sync.service';

// Add to constructor:
private readonly syncService: AccountingSyncService,

@Post('test-connection')
@Roles(UserRole.ADMIN)
async testConnection(@Request() req) {
  return this.syncService.testConnection(req.tenantId);
}
```

- [ ] **Step 3: Add sync endpoint to sales-invoice controller**

Add to `sales-invoice.controller.ts`:

```typescript
import { AccountingSyncService } from '../services/accounting-sync.service';

// Add to constructor:
private readonly syncService: AccountingSyncService,

@Post(':id/sync')
@Roles(UserRole.ADMIN, UserRole.MANAGER)
async syncToProvider(@Param('id') id: string, @Request() req) {
  await this.syncService.syncInvoice(id, req.tenantId);
  return this.service.findOne(id, req.tenantId);
}
```

- [ ] **Step 4: Auto-sync after invoice creation**

In `sales-invoice.service.ts`, inject `AccountingSyncService` and at the end of `createFromOrder`, add fire-and-forget sync:

```typescript
import { AccountingSyncService } from './accounting-sync.service';

// In constructor:
@Optional() private syncService?: AccountingSyncService,

// At end of createFromOrder, after prisma.salesInvoice.create:
if (this.syncService) {
  const accSettings = await this.settingsService.findByTenant(tenantId);
  if (accSettings.autoSync && accSettings.provider !== 'NONE') {
    this.syncService.syncInvoice(invoice.id, tenantId).catch((err) => {
      console.error('Auto-sync failed:', err.message);
    });
  }
}
```

- [ ] **Step 5: Update AccountingModule**

Add `AccountingSyncService` to providers and exports.

- [ ] **Step 6: Build and verify**

```bash
cd backend && npm run build
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/accounting/
git commit -m "feat(accounting): add Paraşüt sync service with auto-sync support"
```

---

## FAZ 4: E-FATURA (FORIBA/SOVOS) ENTEGRASYONU

### Task 12: Foriba e-Fatura adapter

**Files:**
- Create: `backend/src/modules/accounting/adapters/foriba-efatura.adapter.ts`

- [ ] **Step 1: Create Foriba adapter**

```typescript
// backend/src/modules/accounting/adapters/foriba-efatura.adapter.ts
import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { AccountingAdapter, AccountingInvoiceData } from './accounting-adapter.interface';

export class ForibaEfaturaAdapter implements AccountingAdapter {
  readonly name = 'foriba';
  private readonly logger = new Logger(ForibaEfaturaAdapter.name);
  private httpClient: AxiosInstance;

  constructor() {
    this.httpClient = axios.create({ timeout: 30000 });
  }

  async authenticate(credentials: Record<string, string>): Promise<{ accessToken: string; expiresAt?: Date }> {
    const response = await this.httpClient.post(
      `${credentials.apiUrl}/token`,
      new URLSearchParams({
        grant_type: 'password',
        username: credentials.username,
        password: credentials.password,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    return {
      accessToken: response.data.access_token,
      expiresAt: new Date(Date.now() + (response.data.expires_in || 3600) * 1000),
    };
  }

  async pushInvoice(token: string, _companyId: string, invoice: AccountingInvoiceData): Promise<{ externalId: string }> {
    const ublXml = this.generateUblTrXml(invoice);

    const response = await this.httpClient.post(
      `${this.getBaseUrl()}/dispatch-invoice`,
      { content: Buffer.from(ublXml).toString('base64') },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    const externalId = response.data?.uuid || response.data?.id || `foriba-${Date.now()}`;
    this.logger.log(`e-Fatura dispatched: ${externalId}`);
    return { externalId };
  }

  async testConnection(credentials: Record<string, string>): Promise<boolean> {
    try {
      await this.authenticate(credentials);
      return true;
    } catch {
      return false;
    }
  }

  private getBaseUrl(): string {
    return 'https://api.fitbulut.com/v2';
  }

  /**
   * Generate UBL-TR 1.2 compatible XML for Turkish e-invoice.
   * This is a simplified version - production would need full UBL-TR compliance.
   */
  private generateUblTrXml(invoice: AccountingInvoiceData): string {
    const uuid = this.generateUUID();
    const lineItems = invoice.items
      .map(
        (item, index) => `
      <cac:InvoiceLine>
        <cbc:ID>${index + 1}</cbc:ID>
        <cbc:InvoicedQuantity unitCode="C62">${item.quantity}</cbc:InvoicedQuantity>
        <cbc:LineExtensionAmount currencyID="${invoice.currency}">${(item.unitPrice * item.quantity).toFixed(2)}</cbc:LineExtensionAmount>
        <cac:TaxTotal>
          <cbc:TaxAmount currencyID="${invoice.currency}">${((item.unitPrice * item.quantity * item.taxRate) / 100).toFixed(2)}</cbc:TaxAmount>
          <cac:TaxSubtotal>
            <cbc:TaxableAmount currencyID="${invoice.currency}">${(item.unitPrice * item.quantity).toFixed(2)}</cbc:TaxableAmount>
            <cbc:TaxAmount currencyID="${invoice.currency}">${((item.unitPrice * item.quantity * item.taxRate) / 100).toFixed(2)}</cbc:TaxAmount>
            <cbc:Percent>${item.taxRate}</cbc:Percent>
            <cac:TaxCategory>
              <cac:TaxScheme>
                <cbc:Name>KDV</cbc:Name>
                <cbc:TaxTypeCode>0015</cbc:TaxTypeCode>
              </cac:TaxScheme>
            </cac:TaxCategory>
          </cac:TaxSubtotal>
        </cac:TaxTotal>
        <cac:Item>
          <cbc:Name>${this.escapeXml(item.description)}</cbc:Name>
        </cac:Item>
        <cac:Price>
          <cbc:PriceAmount currencyID="${invoice.currency}">${item.unitPrice.toFixed(2)}</cbc:PriceAmount>
        </cac:Price>
      </cac:InvoiceLine>`,
      )
      .join('\n');

    const totalExcTax = invoice.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
    const totalTax = invoice.items.reduce((s, i) => s + (i.unitPrice * i.quantity * i.taxRate) / 100, 0);

    return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>TR1.2</cbc:CustomizationID>
  <cbc:ProfileID>TICARIFATURA</cbc:ProfileID>
  <cbc:ID>${invoice.invoiceNumber}</cbc:ID>
  <cbc:UUID>${uuid}</cbc:UUID>
  <cbc:IssueDate>${invoice.issueDate}</cbc:IssueDate>
  <cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${invoice.currency}</cbc:DocumentCurrencyCode>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>${this.escapeXml(invoice.customerName || 'Müşteri')}</cbc:Name>
      </cac:PartyName>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${invoice.currency}">${totalTax.toFixed(2)}</cbc:TaxAmount>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${invoice.currency}">${totalExcTax.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${invoice.currency}">${totalExcTax.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${invoice.currency}">${invoice.totalAmount.toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${invoice.currency}">${invoice.totalAmount.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${lineItems}
</Invoice>`;
  }

  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
```

- [ ] **Step 2: Register Foriba adapter in AccountingSyncService**

In `accounting-sync.service.ts`, update `getAdapter`:

```typescript
import { ForibaEfaturaAdapter } from '../adapters/foriba-efatura.adapter';

// In getAdapter:
case AccountingProvider.FORIBA:
  return new ForibaEfaturaAdapter();
```

- [ ] **Step 3: Build and verify**

```bash
cd backend && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/accounting/
git commit -m "feat(accounting): add Foriba e-Fatura adapter with UBL-TR XML generation"
```

---

## FAZ 5: LOGO ENTEGRASYONU

### Task 13: Logo REST API adapter

**Files:**
- Create: `backend/src/modules/accounting/adapters/logo.adapter.ts`

- [ ] **Step 1: Create Logo adapter**

```typescript
// backend/src/modules/accounting/adapters/logo.adapter.ts
import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { AccountingAdapter, AccountingInvoiceData } from './accounting-adapter.interface';

export class LogoAdapter implements AccountingAdapter {
  readonly name = 'logo';
  private readonly logger = new Logger(LogoAdapter.name);
  private httpClient: AxiosInstance;

  constructor() {
    this.httpClient = axios.create({ timeout: 15000 });
  }

  async authenticate(credentials: Record<string, string>): Promise<{ accessToken: string; expiresAt?: Date }> {
    const response = await this.httpClient.post(
      `${credentials.apiUrl}/api/v1/token`,
      {
        username: credentials.username,
        password: credentials.password,
        firmNumber: parseInt(credentials.firmNumber) || 1,
      },
    );

    return {
      accessToken: response.data.token || response.data.access_token,
      expiresAt: new Date(Date.now() + 3600000), // 1 hour default
    };
  }

  async pushInvoice(token: string, companyId: string, invoice: AccountingInvoiceData): Promise<{ externalId: string }> {
    const baseUrl = this.httpClient.defaults.baseURL;

    // Create sales invoice in Logo
    const logoInvoice = {
      TYPE: 7, // Sales invoice
      NUMBER: invoice.invoiceNumber,
      DATE: invoice.issueDate,
      DOC_NUMBER: invoice.invoiceNumber,
      ARP_CODE: invoice.customerTaxId || '',
      TOTAL_DISCOUNTS: 0,
      TOTAL_NET: invoice.totalAmount,
      TRANSACTIONS: {
        items: invoice.items.map((item, index) => ({
          TYPE: 0, // Material
          MASTER_CODE: '', // Product code
          QUANTITY: item.quantity,
          PRICE: item.unitPrice,
          VAT_RATE: item.taxRate,
          DESCRIPTION: item.description,
          SOURCEINDEX: index,
        })),
      },
    };

    const response = await this.httpClient.post(
      `${baseUrl}/api/v1/salesInvoices`,
      logoInvoice,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    const externalId = response.data?.INTERNAL_REFERENCE?.toString() || `logo-${Date.now()}`;
    this.logger.log(`Logo invoice created: ${externalId}`);
    return { externalId };
  }

  async testConnection(credentials: Record<string, string>): Promise<boolean> {
    try {
      this.httpClient.defaults.baseURL = credentials.apiUrl;
      await this.authenticate(credentials);
      return true;
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 2: Register Logo adapter in AccountingSyncService**

In `accounting-sync.service.ts`, update `getAdapter`:

```typescript
import { LogoAdapter } from '../adapters/logo.adapter';

// In getAdapter:
case AccountingProvider.LOGO:
  return new LogoAdapter();
```

- [ ] **Step 3: Build and verify**

```bash
cd backend && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/accounting/
git commit -m "feat(accounting): add Logo REST API adapter"
```

---

## FAZ 6: FRONTEND

### Task 14: Frontend API hooks ve types

**Files:**
- Create: `frontend/src/features/accounting/types.ts`
- Create: `frontend/src/features/accounting/accountingApi.ts`

- [ ] **Step 1: Create types**

```typescript
// frontend/src/features/accounting/types.ts
export interface AccountingSettings {
  id: string;
  tenantId: string;
  autoGenerateInvoice: boolean;
  companyName?: string;
  companyTaxId?: string;
  companyTaxOffice?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  provider: string;
  autoSync: boolean;
  hasParasutCredentials: boolean;
  hasLogoCredentials: boolean;
  hasForibaCredentials: boolean;
  invoicePrefix: string;
  nextInvoiceNumber: number;
  defaultPaymentTermDays: number;
}

export interface SalesInvoice {
  id: string;
  invoiceNumber: string;
  type: string;
  status: string;
  customerName?: string;
  customerTaxId?: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  discount: number;
  currency: string;
  paymentMethod?: string;
  externalProvider?: string;
  externalStatus?: string;
  syncedAt?: string;
  syncError?: string;
  issueDate: string;
  items: SalesInvoiceItem[];
}

export interface SalesInvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  taxAmount: number;
  subtotal: number;
  total: number;
}
```

- [ ] **Step 2: Create API hooks**

```typescript
// frontend/src/features/accounting/accountingApi.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import { AccountingSettings, SalesInvoice } from './types';

export const useGetAccountingSettings = () =>
  useQuery<AccountingSettings>({
    queryKey: ['accountingSettings'],
    queryFn: async () => (await api.get('/accounting-settings')).data,
  });

export const useUpdateAccountingSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<AccountingSettings>) => (await api.patch('/accounting-settings', data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accountingSettings'] }),
  });
};

export const useTestAccountingConnection = () =>
  useMutation({
    mutationFn: async () => (await api.post('/accounting-settings/test-connection')).data,
  });

export const useGetSalesInvoices = (params?: Record<string, any>) =>
  useQuery({
    queryKey: ['salesInvoices', params],
    queryFn: async () => (await api.get('/sales-invoices', { params })).data,
  });

export const useGetSalesInvoice = (id: string) =>
  useQuery<SalesInvoice>({
    queryKey: ['salesInvoice', id],
    queryFn: async () => (await api.get(`/sales-invoices/${id}`)).data,
    enabled: !!id,
  });

export const useCreateInvoiceFromOrder = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, ...dto }: { orderId: string } & Record<string, any>) =>
      (await api.post(`/sales-invoices/from-order/${orderId}`, dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['salesInvoices'] }),
  });
};

export const useSyncInvoice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/sales-invoices/${id}/sync`)).data,
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['salesInvoice', id] });
      qc.invalidateQueries({ queryKey: ['salesInvoices'] });
    },
  });
};

export const useCancelInvoice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.patch(`/sales-invoices/${id}/cancel`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['salesInvoices'] }),
  });
};
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/accounting/
git commit -m "feat(accounting): add frontend API hooks and TypeScript types"
```

---

### Task 15: Accounting Settings page (frontend)

**Files:**
- Create: `frontend/src/pages/settings/AccountingSettingsPage.tsx`
- Modify: `frontend/src/pages/settings/SettingsLayout.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/i18n/locales/tr/settings.json`
- Modify: `frontend/src/i18n/locales/en/settings.json`

- [ ] **Step 1: Create AccountingSettingsPage**

Follow the exact `POSSettingsPage.tsx` pattern with `useAutoSave`. Sections:
1. Company Info (companyName, companyTaxId, companyTaxOffice, companyAddress)
2. Invoice Settings (autoGenerateInvoice toggle, invoicePrefix, defaultPaymentTermDays)
3. Accounting Provider selection (NONE/PARASUT/LOGO/FORIBA dropdown)
4. Provider-specific credential inputs (conditionally shown)
5. Auto-sync toggle
6. Test Connection button

This is a larger component (~200 lines). The structure follows `POSSettingsPage.tsx` exactly with `useAutoSave`, `SettingsSection`, `SettingsToggle`, and input fields.

- [ ] **Step 2: Add route and nav item**

In `App.tsx`, add import and route:
```typescript
import AccountingSettingsPage from './pages/settings/AccountingSettingsPage';
// In settings routes:
<Route path="accounting" element={<AccountingSettingsPage />} />
```

In `SettingsLayout.tsx`, add nav item with `Receipt` icon from lucide-react:
```typescript
{ to: '/admin/settings/accounting', icon: Receipt, label: t('nav.accounting') }
```

- [ ] **Step 3: Add i18n translations**

In `tr/settings.json` nav:
```json
"accounting": "Muhasebe"
```

Add `accounting` section with labels for all fields.

In `en/settings.json` nav:
```json
"accounting": "Accounting"
```

- [ ] **Step 4: Build frontend**

```bash
cd frontend && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/
git commit -m "feat(accounting): add accounting settings page with provider configuration"
```

---

### Task 16: Sales Invoices list page (frontend)

**Files:**
- Create: `frontend/src/pages/admin/invoices/InvoicesPage.tsx`
- Modify: `frontend/src/App.tsx` (add route)
- Modify: `frontend/src/components/layout/Sidebar.tsx` (add nav item)

- [ ] **Step 1: Create InvoicesPage**

A table view showing all sales invoices with:
- Filters: status, date range, search
- Columns: Invoice #, Customer, Date, Amount, Tax, Status, Sync Status, Actions
- Actions: View detail, Sync to provider, Cancel

- [ ] **Step 2: Add route**

```typescript
<Route path="/admin/invoices" element={<InvoicesPage />} />
```

- [ ] **Step 3: Add to sidebar**

Add "Faturalar" nav item with `Receipt` icon, after "Raporlar", with `@Roles(ADMIN, MANAGER)`.

- [ ] **Step 4: Build and verify**

```bash
cd frontend && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/
git commit -m "feat(accounting): add sales invoices list page"
```

---

## DOĞRULAMA (Verification)

After all tasks are complete:

- [ ] **Backend build:** `cd backend && npm run build` → compiled successfully
- [ ] **Frontend build:** `cd frontend && npm run build` → built successfully
- [ ] **Database sync:** `cd backend && npx prisma db push` → in sync
- [ ] **GET /accounting-settings** → returns default settings (provider: NONE)
- [ ] **PATCH /accounting-settings** → updates settings
- [ ] **POST /sales-invoices/from-order/:orderId** → creates invoice from paid order
- [ ] **GET /sales-invoices** → lists invoices with pagination
- [ ] **POST /accounting-settings/test-connection** → tests provider connection
- [ ] **POST /sales-invoices/:id/sync** → syncs invoice to configured provider
- [ ] **Frontend:** Ayarlar > Muhasebe sayfası açılır, provider seçimi ve credential girişi çalışır
- [ ] **Frontend:** Faturalar sayfası açılır, liste ve filtreleme çalışır
