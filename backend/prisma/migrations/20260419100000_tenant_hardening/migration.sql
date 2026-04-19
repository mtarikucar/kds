-- Subdomain quarantine table: released subdomains cannot be reclaimed until
-- availableAfter has passed. Protects against subdomain-takeover phishing.
CREATE TABLE "reserved_subdomains" (
    "id" TEXT NOT NULL,
    "subdomain" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "availableAfter" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reserved_subdomains_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reserved_subdomains_subdomain_key" ON "reserved_subdomains"("subdomain");
CREATE INDEX "reserved_subdomains_availableAfter_idx" ON "reserved_subdomains"("availableAfter");

-- Accelerate tenant status-filtered queries (SuperAdmin list/count, auth lookup)
CREATE INDEX "tenants_status_idx" ON "tenants"("status");
