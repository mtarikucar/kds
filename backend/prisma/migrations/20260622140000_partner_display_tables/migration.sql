-- Partner Display API: credential + per-screen session tables.

-- CreateTable
CREATE TABLE "partner_api_keys" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedReturnOrigins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedBranchIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastUsedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "partner_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screen_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "tableId" TEXT,
    "partnerApiKeyId" TEXT NOT NULL,
    "orderingSessionId" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tokenHash" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "screen_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_api_keys_keyId_key" ON "partner_api_keys"("keyId");
CREATE INDEX "partner_api_keys_tenantId_status_idx" ON "partner_api_keys"("tenantId", "status");
CREATE INDEX "partner_api_keys_keyId_idx" ON "partner_api_keys"("keyId");

-- CreateIndex
CREATE UNIQUE INDEX "screen_sessions_orderingSessionId_key" ON "screen_sessions"("orderingSessionId");
CREATE UNIQUE INDEX "screen_sessions_tokenHash_key" ON "screen_sessions"("tokenHash");
CREATE UNIQUE INDEX "screen_sessions_refreshTokenHash_key" ON "screen_sessions"("refreshTokenHash");
CREATE INDEX "screen_sessions_tenantId_branchId_status_idx" ON "screen_sessions"("tenantId", "branchId", "status");
CREATE INDEX "screen_sessions_tokenHash_idx" ON "screen_sessions"("tokenHash");
CREATE INDEX "screen_sessions_partnerApiKeyId_idx" ON "screen_sessions"("partnerApiKeyId");

-- AddForeignKey
ALTER TABLE "partner_api_keys" ADD CONSTRAINT "partner_api_keys_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screen_sessions" ADD CONSTRAINT "screen_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screen_sessions" ADD CONSTRAINT "screen_sessions_partnerApiKeyId_fkey" FOREIGN KEY ("partnerApiKeyId") REFERENCES "partner_api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
