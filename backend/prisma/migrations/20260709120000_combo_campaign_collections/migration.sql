-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('STANDARD', 'COMBO');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "campaignEndAt" TIMESTAMP(3),
ADD COLUMN     "campaignLabel" VARCHAR(40),
ADD COLUMN     "campaignPrice" DECIMAL(10,2),
ADD COLUMN     "campaignStartAt" TIMESTAMP(3),
ADD COLUMN     "productType" "ProductType" NOT NULL DEFAULT 'STANDARD';

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "listUnitPrice" DECIMAL(10,2),
ADD COLUMN     "parentOrderItemId" TEXT;

-- CreateTable
CREATE TABLE "combo_groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "minSelect" INTEGER NOT NULL DEFAULT 1,
    "maxSelect" INTEGER NOT NULL DEFAULT 1,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "comboProductId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "combo_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "combo_group_items" (
    "id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "priceDelta" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "groupId" TEXT NOT NULL,
    "componentProductId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "combo_group_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_collections" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_collections" (
    "id" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "productId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_collections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "combo_groups_comboProductId_idx" ON "combo_groups"("comboProductId");

-- CreateIndex
CREATE INDEX "combo_groups_tenantId_idx" ON "combo_groups"("tenantId");

-- CreateIndex
CREATE INDEX "combo_group_items_groupId_idx" ON "combo_group_items"("groupId");

-- CreateIndex
CREATE INDEX "combo_group_items_componentProductId_idx" ON "combo_group_items"("componentProductId");

-- CreateIndex
CREATE INDEX "combo_group_items_tenantId_idx" ON "combo_group_items"("tenantId");

-- CreateIndex
CREATE INDEX "menu_collections_tenantId_idx" ON "menu_collections"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "menu_collections_tenantId_slug_key" ON "menu_collections"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "product_collections_collectionId_idx" ON "product_collections"("collectionId");

-- CreateIndex
CREATE INDEX "product_collections_tenantId_idx" ON "product_collections"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "product_collections_productId_collectionId_key" ON "product_collections"("productId", "collectionId");

-- CreateIndex
CREATE INDEX "order_items_parentOrderItemId_idx" ON "order_items"("parentOrderItemId");

-- AddForeignKey
ALTER TABLE "combo_groups" ADD CONSTRAINT "combo_groups_comboProductId_fkey" FOREIGN KEY ("comboProductId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combo_group_items" ADD CONSTRAINT "combo_group_items_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "combo_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combo_group_items" ADD CONSTRAINT "combo_group_items_componentProductId_fkey" FOREIGN KEY ("componentProductId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_collections" ADD CONSTRAINT "product_collections_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_collections" ADD CONSTRAINT "product_collections_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "menu_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_parentOrderItemId_fkey" FOREIGN KEY ("parentOrderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

