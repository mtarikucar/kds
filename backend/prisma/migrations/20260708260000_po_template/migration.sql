-- Reusable purchase-order templates for repeat/standing orders.
CREATE TABLE "purchase_order_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "purchase_order_templates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "purchase_order_templates_tenantId_branchId_idx" ON "purchase_order_templates"("tenantId", "branchId");

CREATE TABLE "purchase_order_template_items" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    CONSTRAINT "purchase_order_template_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "purchase_order_template_items_templateId_idx" ON "purchase_order_template_items"("templateId");
ALTER TABLE "purchase_order_template_items" ADD CONSTRAINT "purchase_order_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "purchase_order_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
