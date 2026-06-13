-- Track 4 (public-stats perf): the live-stats aggregates (views today/week/
-- month) filter page_views on createdAt alone. The existing composite
-- (page, createdAt) index can't serve those — its leading column is `page` —
-- so the counts fall back to a full table scan as traffic grows. Add a
-- standalone createdAt index.
CREATE INDEX "page_views_createdAt_idx" ON "page_views"("createdAt");
