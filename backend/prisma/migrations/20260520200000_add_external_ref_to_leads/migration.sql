ALTER TABLE "leads" ADD COLUMN "externalRef" TEXT;
CREATE UNIQUE INDEX "leads_externalRef_key" ON "leads"("externalRef");
