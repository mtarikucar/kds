# kds (HummyTummy) — Production-Readiness Altyapı Raporu

## 1. Yönetici özeti

Bu kod tabanı, tek-VPS bir SaaS için olağanüstü olgun bir deploy/CI hattına, gerçek transactional outbox'a, sağlam SSRF/tenant-izolasyon korumalarına ve çoklu-replica niyetiyle yazılmış altyapıya sahip — ama **şu anki haliyle gerçek ödeme yapan tenant'lar için GO-LIVE'a hazır DEĞİL**. En büyük tek risk, **public git geçmişinde okunabilir ve döndürülmemiş canlı prod secret'larıdır** (özellikle simetrik `JWT_SECRET`): bu, tam çok-tenant'lı kimlik-sahteciliği / hesap-devralma yolu açar ve repo tarandığı anda canlı müşteri-para/PII ihlaline döner. Bunun hemen yanında: tüm yedeklerin DB ile aynı diskte tek VPS'te durması (host kaybı = geri dönüşsüz tam veri kaybı), gerçek PII içeren prod DB dump'larının git'e commit'lenmiş olması, backend API'sinin `0.0.0.0:3000`'de doğrudan internete açık olması (TLS/nginx bypass) ve `default` adlı throttler hiç register edilmediği için **tüm auth/login/register/2FA rate-limit'lerinin sessizce devre dışı** olması.

**Sayım (düzeltilmiş severity ile, refuted çıkarılmış, deduplike edilmiş):**
- 🔴 **Blocker: 4**
- 🟠 **Critical/High: 9**
- 🟡 **Medium: ~14**
- ⚪ **Low/Hardening: ~13**

İlk ölçeklenmede (2. replica eklendiğinde) ne kırılır: advisory-lock sızıntısı (billing/webhook cron'ları sessizce durur), in-memory throttle (limitler N× çoğalır), local-disk upload'lar (LB arkasında asset 404), Socket.IO Redis adapter'ın kalıcı reconnect-vazgeçişi (realtime fan-out yarıya düşer).

---

## 2. Şu an sağlam olanlar (regresyona uğratmayın)

- **Deploy hattı:** immutable `:vX.Y.Z`→`:current` atomic retag + SHA-verify (`scripts/deploy.sh:397-538`), health-gated swap (`wait_until_healthy`), ERR-trap otomatik image-rollback, deploy-öncesi doğrulanmış pg_dump (gzip -t + ≥5 CREATE + >1KB), prod/staging concurrency-group asimetrisi (prod sıraya girer, staging cancel-in-progress).
- **Transactional outbox:** para/lifecycle producer'ları event'i iş-transaction'ı içinde `tx` ile append ediyor (`paytr-settlement.service.ts:342/370`), worker `FOR UPDATE SKIP LOCKED` ile claim ediyor, gerçek DLQ + crash-reclaim reaper + retention pruner var. `DomainEventBus` her listener throw'unu izole ediyor (double-projection footgun'u kapalı).
- **Güvenlik tabanı:** güçlü SSRF guard (`url-safety.ts`, IMDS/private-CIDR kapsamı, fetch öncesi re-validate), DB-doğrulamalı tenant-izolasyonu `BranchGuard`, sertleştirilmiş upload (magic-byte sniff, SVG red, sharp re-encode, UUID isim), `httpOnly+secure+sameSite=strict` refresh cookie (token'lar bilinçli olarak localStorage'da DEĞİL), ayrı superadmin JWT realm + 2FA, reflektif olmayan CORS.
- **Boot-time fail-fast env doğrulaması** (`env-validation.ts`): eksik/kısa/aynı-realm secret ve `PAYTR_TEST_MODE` prod'da hard-fail; CI secret pre-flight build'den önce çalışıyor.
- **Veri katmanı:** hot tablolarda doğru composite index'ler, `RefreshToken.tokenHash`/`ScreenSession.tokenHash` artık `@unique`, Prisma query-log prod'da kapalı.
- **Datastore izolasyonu:** Postgres/Redis yalnızca `127.0.0.1`'e bind (`docker-compose.prod.yml:27`), Redis AUTH + ayrı logical DB.
- **Backup mekanizması (içerik doğrulama tarafı):** `gzip -t` + PIPESTATUS + CREATE-sayım + sub-1KB reddi gerçek; migration doctor non-idempotent recovery'i hard-fail ediyor.

---

## 3. 🔴 GO-LIVE BLOCKERS (gerçek tenant almadan önce ŞART)

### B1. Canlı prod secret'ları public git geçmişinde okunabilir ve döndürülmemiş
- **Kanıt:** `git show 5d75ef44:.env.default.backup` ve `bc5d8667:.env.test` — `JWT_SECRET=o9wiRcQp…XoZ6`, `JWT_REFRESH_SECRET`, `POSTGRES_PASSWORD=wLCtzGnukqqnBvQqBFpo217EOVpvVjgT`, `EMAIL_PASSWORD=Merhabalar06.`, `DESKTOP_RELEASE_API_KEY`. Repo `mtarikucar/kds` `isPrivate:false`. Token'lar HS256 (simetrik) ile imzalanıp doğrulanıyor (`token.service.ts:84-101`, `jwt.strategy.ts:41-46`); asimetrik/JWKS/kid yok. `tokenVersion` sahteciliği engellemiyor (default 0, saldırgan `ver:0` koyar — `jwt.strategy.ts:81-84`).
- **Etki:** İnternetteki herkes herhangi bir tenant'ın herhangi bir kullanıcı/rolü için geçerli access + refresh JWT üretebilir → **tam çok-tenant kimlik-sahteciliği ve hesap/veri devralma**, giden mailin okunması, Postgres'e bağlanma (erişilebilirse). Repo tarandığı an canlı ihlal.
- **Çözüm:** `JWT_SECRET`, `JWT_REFRESH_SECRET`, `POSTGRES_PASSWORD` (rol+secret+`DATABASE_URL`), `EMAIL_PASSWORD`, `DESKTOP_RELEASE_API_KEY`'i GitHub Secrets üzerinden **HEMEN döndür** ve redeploy (JWT döndürmek herkesi logout eder — kabul edilebilir). Döndürme tek başına maruziyeti nötralize eder ve history-purge'den bağımsızdır. Sonra `git filter-repo` ile geçmişi temizle + repoyu tekrar private yap. `ENCRYPTION_MASTER_KEY`/`INTEGRATION_KEY`/`SUPERADMIN_*` herhangi bir tarihsel `.env`'de geçtiyse onları da döndür.
- **Efor:** Orta (döndürme küçük; history-purge orta, aktif session'larla koordinasyon).

### B2. Yedekler DB ile aynı tek VPS diskinde — offsite kopya yok
- **Kanıt:** `scripts/backup-database.sh:57` ve `scripts/deploy.sh:215-219` → `BACKUP_DIR="$PROJECT_ROOT/backups/database"` (host dizini, ayrı volume bile değil). `docs/DEPLOYMENT.md:8-10`: staging+prod tek VPS (`38.242.233.166`). rclone/s3/object-storage hiç yok (yalnızca `backup-database.sh:16`'da yapılmamış TODO).
- **Etki:** Disk arızası / host ele geçirme / ransomware / instance termination → DB **VE** 14 günlük tüm yedekler birlikte gider. RTO sonsuz, RPO total (tüm tenant verisi). Yedeklerin koruduğu sunucuyla ölmesi = yedek değil.
- **Çözüm:** Her doğrulanmış yedeği üretildikten hemen sonra offsite'a (Backblaze B2 / S3 / başka sağlayıcı) `rclone`/`aws s3 cp` ile gönder, kendi retention'ı ile. Offsite kopyayı otoriter kabul et.
- **Efor:** Küçük.

### B3. Gerçek PII içeren prod DB dump'ları public repoya commit'lenmiş
- **Kanıt:** `git ls-files backups/` → 20 adet `.sql.gz`. `backup_20260409_142738.sql.gz` açıldığında 85 `COPY public.*` bloğu (customers, users, api_keys, audit_logs, payments, invoices, super_admins), 133 e-posta (`abdukahar1212@gmail.com`, …) ve `users.password` sütununda 16 bcrypt hash + resetToken/googleId. `.gitignore` yalnızca `.env*`'i kapsıyor; `git check-ignore` → NOT IGNORED. Kök neden: `backup-database.sh:57` yedeği repo ağacının içine yazıyor.
- **Etki:** Repoyu klonlayan herkes gerçek tenant+müşteri PII'sine ve `api_keys` tablosuna erişir — leaked-secrets'tan bağımsız bir **GDPR/KVKK ihlali**. Silinse bile geçmişte kalıcı.
- **Çözüm:** `backups/`'ı `.gitignore`'a ekle, `git rm --cached` ile dump'ları çıkar, `git filter-repo` purge'üne dahil et. `BACKUP_DIR`'i `/root/kds` dışına taşı. Maruz kalan api_key'leri döndür.
- **Efor:** Küçük.

### B4. Backend API'si `0.0.0.0:3000`'de doğrudan internete açık (nginx/TLS bypass) + host firewall'u repoda yok
- **Kanıt:** `docker-compose.prod.yml:128` backend `'3000:3000'` (host-IP prefix yok → 0.0.0.0); aynı şekilde frontend `8080:80`, landing `3100`, developer `3200`, help `3201`. Karşılaştırma: postgres `127.0.0.1:5432:5432`. nginx yalnızca `127.0.0.1:3000`'e proxy'liyor (`hummytummy.com.conf:45`). Repo genelinde `ufw/iptables/nftables/cloudflared` codified değil (yalnızca düz-metin notlar). VPS IP'si (`38.242.233.166`) zaten repoda.
- **Etki:** Saldırgan `http://<VPS-IP>:3000/api/*`'a düz HTTP ile ulaşır — TLS, HSTS, (zaten eksik) edge rate-limit ve Cloudflare WAF/DDoS tamamen bypass. `default` throttler inert + `trust proxy=1` olduğu için doğrudan-origin brute-force pratikte sınırsız ve X-Forwarded-For sahteciliğine açık. `/api/metrics` ayrıca authsuz BI/recon sızıntısı (bkz. H6).
- **Çözüm:** Her public app container'ını `127.0.0.1:PORT:PORT`'a bind et (postgres gibi). Ek olarak host firewall (ufw/nftables) ile yalnızca 80/443 (+admin'den 22) izin ver, ideali 80/443'ü Cloudflare IP aralıklarına kısıtla. Bunu deploy/bootstrap'a koy ki yeniden kurulan host sessizce açık kalmasın.
- **Efor:** Küçük (bind değişikliği trivial; firewall codify küçük).

---

## 4. 🟠 İlk haftalar / ölçeklenmeden önce (critical/high)

### H1. Advisory-lock acquire/release farklı pooled connection'larda → session-scoped kilit sızar, cron'lar sessizce durur *(cross-cutting: database + jobs + scaling)*
- **Kanıt:** `common/scheduling/advisory-lock.ts:27-40` `pg_try_advisory_lock` ve `pg_advisory_unlock`'u İKİ ayrı `prisma.$queryRawUnsafe` ile çalıştırıyor — `$transaction` yok, `pg_advisory_xact_lock` yok. Aynı pattern inline olarak `subscription-scheduler.service.ts:61-74`, `z-report-scheduler.service.ts:33/55`, `stock-alerts.scheduler.ts:38/75`, `token-refresh.scheduler.ts:24/36`, `order-polling.scheduler.ts:51/59`'da tekrarlanıyor. Hiçbir `DATABASE_URL`'de `connection_limit` yok → Prisma default `num_cpus*2+1` pool. Unlock farklı connection'a düşünce no-op olur, kilit acquire eden connection'da kalır; sonraki tick başka connection'dan `pg_try_advisory_lock` çağırınca kilidi tutulu görüp atlar. `advisory-lock.spec.ts` `$queryRawUnsafe`'i mock'luyor → bug test'lerde görünmez.
- **Etki:** ~15 cron etkileniyor — **subscription period-end billing, trial-expiry, past-due, paytr-pending-recovery, self-pay sweeper, webhook delivery, delivery reconciliation, stock alerts, z-report**. Sızan kilit, cron'un sessizce (hata logu olmadan) çalışmayı durdurmasına yol açar → abonelikler ücretlendirilmez/yenilenmez, webhook'lar gitmez. **Tek replica'da bile** olur (Prisma süreç içinde connection pool'lar); ikinci replica + yük altında olasılık artar. Olasılıksal (her tick değil) ve restart'ta self-heal eder, bu yüzden critical değil high.
- **Çözüm:** Acquire+work+release'i tek pinned connection'a sabitle: `pg_advisory_xact_lock(id)`'i interactive `prisma.$transaction(async (tx) => {...})` içinde kullan (COMMIT'te otomatik release, manuel unlock yok, cross-connection riski yok), `run()` aynı `tx`'i kullansın. `advisory-lock.ts` + 5 inline scheduler'a uygula. İkinci kez acquire'ın başarılı olduğunu doğrulayan gerçek-Postgres çok-tick test'i ekle.
- **Efor:** Küçük/Orta.

### H2. `default` adlı throttler register edilmemiş → ~60 default-anahtarlı `@Throttle` INERT (login/register/2FA/refresh/forgot dahil) *(cross-cutting: ratelimit + redis + security + scaling + realtime + performance)*
- **Kanıt:** `app.module.ts:82-98` yalnızca `short`/`medium`/`long` register ediyor — `default` yok. `@nestjs/throttler@6.4.0` guard (`throttler.guard.js`) yalnızca register edilmiş throttler'ları gezip override'ı `THROTTLER_LIMIT + namedThrottler.name` ile okuyor; `default`-anahtarlı metadata hiç okunmuyor. Etkilenen: `auth.controller.ts:40-58` (LOGIN 5/min, REGISTER 3/hr, FORGOT/VERIFY/CHANGE_PASSWORD 5/min, SOCIAL/REFRESH), `superadmin-auth.controller.ts:36-38` (2FA dahil), device pair (`devices.controller.ts:146`), QR-menu, public-reservations, self-pay, customer-orders, webhook, contact, caller. `MachineThrottlerGuard` yalnızca `getTracker`'ı override ediyor, çözüm sunmuyor.
- **Etki:** Endpoint'ler intended sıkı limit yerine global `long`'a (≈100/min/IP) düşüyor — login için **~20× gevşek**, register için worst-case ~2000×; superadmin 2FA 6-haneli kod 100/min/IP'de brute-force'lanabilir; SMS/e-posta maliyet-abuse açık. nginx'te telafi edici `limit_req` de yok. Tam-açık değil (global cap var) ama auth yüzeyinde gerçek, sömürülebilir güvenlik regresyonu.
- **Çözüm:** `ThrottlerModule.forRoot`'a `{ name: 'default', ttl, limit }` ekle (mevcut `{default:...}` decorator'lar bağlanır) — VEYA tüm `@Throttle`'ları `short/medium/long`'a hedefle. `/auth/login`'e N+1 istek atıp 429 assert eden integration test ekle (mevcut `auth.controller.throttle.spec.ts` yalnızca decorator'ın EKLİ olduğunu doğruluyor, ATEŞLENDİĞİNİ değil).
- **Efor:** Küçük.

### H3. Yedek geri-yükleme hiç test edilmedi + modern prod rollback DB değil yalnızca image geri yüklüyor + PITR/WAL yok
- **Kanıt:** `scripts/deploy.sh` `run_rollback()` (`670-675`) yalnızca `restore_image_ids()` çağırıyor — DB restore yok; ERR-trap `on_failure()` (`677-685`) de öyle. Tek DB-restore mantığı legacy kök `deploy.sh:223-236`'da: interactive `read -p` + `.sql` (üretilen `.sql.gz` ile uyuşmaz) → CI'da çalışmaz/ölü. `backup-database.sh:18` "restore drill runbook" TODO; `docs/DEPLOYMENT.md`'de DR/restore bölümü yok. Postgres stock `postgres:15-alpine`, `archive_command`/`wal_level` yok → recovery yalnızca tam-dump granülerliğinde. Deploy migration'ı in-place uyguluyor; başarısız data-mutating migration için PITR yok (`deploy.sh:623-625` "manual DB intervention required" diyor).
- **Etki:** Hiç geri-yüklenmemiş yedek = kurtarma planı değil, hipotez. Gerçek olayda (corruption / kötü migration / host rebuild) ekip ilk kez baskı altında restore + decompress + PostGIS-extension + rol-şifre adımlarını runbook'suz doğaçlar; `.sql`/`.sql.gz` uyumsuzluğu ilk adımda patlar. Subtle data-bozan migration → ya corruption ile yaşa ya tüm DB'yi deploy-snapshot'a geri al ve aradaki tüm meşru trafiği kaybet.
- **Çözüm:** `docs/DEPLOYMENT.md`'ye restore runbook yaz (tam komutlar: `gunzip | docker exec psql`, rol/db recreate, PostGIS). `scripts/deploy.sh`'a `restore` action ekle. Throwaway DB'ye satır-sayısı assert eden zamanlanmış restore-drill çalıştır. RPO/RTO'yu açıkça belirt. Sürekli PITR için pgBackRest/wal-g ile WAL archiving'i offsite'a aç (dakika-mertebesi RPO).
- **Efor:** Orta.

### H4. Zamanlanmış otomatik yedek yok — DB yalnızca deploy anında dump'lanıyor (sınırsız RPO)
- **Kanıt:** `backup_database`'in tek otomatik çağrısı deploy-içi step `2/10` (`deploy.sh:647`). `.github/workflows`'ta `schedule:`/cron yok; host crontab/systemd timer yok (tek `0 2 * * *` app'in billing @Cron'u, `docker-compose.prod.yml:82`). `backups/database/` dosyaları deploy-günlerinde kümelenmiş, aralarda günlerce boşluk.
- **Etki:** Release'siz bir hafta sonu → 1+ günlük gerçek tenant order/payment/fiş/stok hareketi **hiçbir yedek olmadan**. O anda disk/Postgres arızası = tüm bu işlemler kalıcı kayıp; fiskal-uyum problemi.
- **Çözüm:** Deploy'dan bağımsız out-of-band yedek: host cron/systemd timer `scripts/backup-database.sh prod`'u her 1-6 saatte + günlük çalıştırsın. Son N saatte başarılı yedek yoksa alert. Deploy-içi yedeği pre-migration güvenlik ağı olarak koru.
- **Efor:** Küçük.

### H5. Üretim'de hiçbir container'da resource limit yok + Node heap cap yok → backend sızıntısı paylaşılan DB'yi OOM'lar *(cross-cutting: containers + database + performance)*
- **Kanıt:** `docker-compose.prod.yml`'de `deploy/resources/mem_limit/cpus` sayısı 0 (staging her servisi cap'liyor). Hiçbir yerde `NODE_OPTIONS=--max-old-space-size` yok. postgres+redis+backend tek VPS'te aynı host RAM'ini paylaşıyor. **Not:** prod plain `docker-compose up` ile çalıştığı için staging'in `deploy.resources` syntax'ı swarm-dışında IGNORE edilir — doğru fix compose-native `mem_limit`/`cpus`.
- **Etki:** Backend memory sızıntısı / büyük PDF-export / yük spike'i host RAM'ini sınırsız tüketir; Linux OOM-killer en büyük RSS'i (sıklıkla postgres) hedefler → **tüm tenant'lar için DB düşer**. Limit yokken docker `OOMKilled=false` raporlar, triage'ı gizler.
- **Çözüm:** Her prod servisine compose-native `mem_limit`+`cpus` ekle; backend'i host RAM eksi postgres/redis rezervasyonunun altına boyutla; `NODE_OPTIONS=--max-old-space-size`'ı container limitinin güvenle altına ayarla (V8 cgroup öldürmeden önce GC yapsın). postgres/redis'e OOM çekişmesini kazanacak rezerv ayır.
- **Efor:** Küçük.

### H6. `/api/metrics` prod'da büyük olasılıkla PUBLIC + backend portu doğrudan açık *(cross-cutting: observability + security)*
- **Kanıt:** `metrics.controller.ts:42-44` `METRICS_TOKEN` set değilse `if (!token) return;` (auth yok), `@Public()`+`@ApiExcludeEndpoint()`. `METRICS_TOKEN` hiçbir prod/staging template'inde yok ve `env-validation`'da prod'da zorunlu değil. nginx `location /api/`'yi allow/deny olmadan proxy'liyor (`hummytummy.com.conf:44-46`); `/api/metrics` için ayrı blok yok. Backend portu `3000:3000` (B4) → ayrıca host IP'sinden doğrudan.
- **Etki:** Authsuz ziyaretçi `payment_intents_total`, `subscription_billing_total`, `auth_login_failures_total`, `cash_drawer_ops_total`, `fiscal_receipts_issued_total`, outbox/delivery DLQ derinliği, per-route hız/gecikme'yi okur — order/ödeme/fiş hacimleri ve login-attack görünürlüğü dahil BI/recon sızıntısı + registry serileştirme availability nibble'ı.
- **Çözüm:** `METRICS_TOKEN`'ı (32+ char) prod/staging template'lerine ekle ve `env-validation`'da prod'da zorunlu kıl, **VE** nginx'e `location = /api/metrics { allow <monitoring-net>; deny all; }` ekle. İkisini de yap. Authsuz curl ile prod URL'inde doğrula.
- **Efor:** Küçük.

### H7. Device & local-bridge bearer token'larında sabit TTL — yenileme/re-claim yok, mesh filosu zamanla auth'u keser
- **Kanıt:** `device.service.ts:256` `tokenExpiresAt=now+24h` yalnızca `pair()`'de; `authenticateToken` geçmişi reddediyor (`340`); `heartbeat` (`344-380`) yalnızca status/lastSeenAt yazıyor, `tokenExpiresAt`'a dokunmuyor; refresh route yok. `local-bridge.service.ts`: claim +30d (`98`), heartbeat slide etmiyor (`167-182`). Agent self-recover edemiyor: `main.rs:116-140` provisioning token'ı tek-kullanımlık ile bir kez claim ediyor (server null'luyor, `service.ts:105`); 401 re-claim yok. Memory'deki slide-on-heartbeat fix'i ağaçta DEĞİL (unmerged branch).
- **Etki:** Her eşleşmiş terminal/printer/yazarkasa pairing'ten ~24h sonra, her bridge ~30d sonra otomatik kurtarma olmadan ölür; cihazlar heartbeat/next-command/ack'te 401 vermeye başlar → operatör her cihazı yeniden eşleştirmeli, her bridge için taze token sağlamalı. **Zamanlayıcıyla filo-çapında donanım kesintisi**, nakit/fiskal akışları vuruyor. (Mesh varsayılan DISABLED olduğu ve TTL env-override'lanabildiği için blocker değil high — ama mesh'i default TTL ile açan tenant kaybeder.)
- **Çözüm:** Her başarılı heartbeat'te `tokenExpiresAt`'ı ileri kaydır (`DeviceService.heartbeat` + `LocalBridgeService.heartbeat`), VEYA authenticated refresh endpoint'leri ekle ve agent 401'i re-claim ile karşılasın.
- **Efor:** Küçük.

### H8. Hiçbir tabloda statement_timeout yok — tek runaway sorgu bir connection'ı süresiz tutar (noisy-neighbor)
- **Kanıt:** `statement_timeout` backend/src, compose, env template, CI'da hiç yok. `PrismaService` yalnızca ham `DATABASE_URL`'i geçiyor, client-side timeout yok. postgres servisinde `-c statement_timeout` override yok. Tek `$transaction` timeout'u `floor-plan.service.ts:438` (interactive-tx client timeout, server-side değil). Sınırsız analytics `groupBy`/`$queryRaw`'lar mevcut. nginx'te `proxy_read_timeout` da yok.
- **Etki:** Küçük pool + timeout yokken, tek yavaş/kilitli analytics sorgusu (veya deploy sırasında non-concurrent `CREATE INDEX` arkasında bloke sorgu) connection'ını çalıştığı sürece tutar; bir avuç böyle sorgu pool'u tüketip alakasız tenant'lar için istek hatalarına kaskad eder — paylaşımlı-pool çok-tenant'ta klasik noisy-neighbor kesintisi.
- **Çözüm:** Connection string ile muhafazakâr server-side default ver (`...&options=-c%20statement_timeout%3D30000`) veya `ALTER ROLE ... SET statement_timeout`, artı takılı transaction'ları biçen `idle_in_transaction_session_timeout`. DDL için `lock_timeout`.
- **Efor:** Küçük.

### H9. Yüksek-hacimli append tablolarında retention/pruning yok — sınırsız büyüme
- **Kanıt:** Yalnızca `outbox_events`'in gerçek pruner'ı var (`outbox-worker.service.ts:123-158`). `callerEvent`/`trafficFlowRecord`/`pageView`/`userActivity`/`auditLog`/`occupancyRecord`/`notification`/`analyticsHeatmapCache` için production cleanup YOK (tek `deleteMany` `mock-data-generator.service.ts:619-627`'de, test-only). `analytics_heatmap_cache` `expiresAt` set edip okumada kontrol ediyor (`heatmap.service.ts:624`) ama HİÇ silinmiyor → sorgulanan her zaman-penceresi için bayat satır birikiyor. `occupancyRecord` kamera frame'i başına `createMany`.
- **Etki:** Gerçek tenant'larda bu tablolar sınırsız büyür → index boyutu, autovacuum maliyeti, sorgu gecikmesi, backup/restore süresi bozulur, sonunda data volume'ünü tüketir. CV-kamera çalıştıran tenant'ta `occupancyRecord` veri hacmini domine eder. Operatörün manuel SQL dışında alan geri-kazanma kolu yok.
- **Çözüm:** Her tablo için sınırlı-batch retention pruner ekle (outbox pruner pattern'i), `analytics_heatmap_cache` için delete-expired pass. Retention pencereleri env-configurable. Her job'ı advisory-lock helper'ı arkasında çalıştır (H1 düzeltildikten sonra) ki yalnızca bir replica budasın.
- **Efor:** Orta.

---

## 5. 🟡 Orta öncelik (should-fix)

**Config drift / runtime doğruluğu**
- **DATABASE_URL pool tuning'i compose'da düşüyor:** `docker-compose.prod.yml:90` `environment:` bloğu `connection_limit=25&pool_timeout=10`'lu rendered `.env.production`'ı geçersiz kılıyor (compose `environment:` > `env_file:`). Prod'da pool sessizce Prisma default'una düşüyor; 2. replica eklenince connection-exhaustion belirleyicisi olur. **Fix:** `DATABASE_URL`'i `environment:` bloğundan çıkar (staging gibi env_file kullansın); replica×limit < `max_connections` boyutla; ~3 replica öncesi pgbouncer/`max_connections` artışı. *(cross-cutting: cicd/containers/database/performance)*
- **`SUPERADMIN_JWT_SECRET` compose'da tenant `JWT_SECRET`'a fallback'liyor:** `docker-compose.prod.yml:96` `${SUPERADMIN_JWT_SECRET:-${JWT_SECRET}}` — bugün boot-guard yakalıyor ama tehlikeli pattern. **Fix:** `${SUPERADMIN_JWT_SECRET:?…}` kullan; `SUPERADMIN_JWT_REFRESH_SECRET`/`ENCRYPTION_MASTER_KEY`'i de explicit `environment:`'a koy.

**Deploy/availability**
- **Tek-replica hard-cutover swap → her deploy'da garantili 502 penceresi:** `swap_backend` (`deploy.sh:446`) eski container'ı yeni listen etmeden durduruyor; nginx tek upstream'e proxy_next_upstream/retry'siz (`hummytummy.com.conf:44-57`). 240s cold-start ile aktif POS/KDS için her release'te görünür kesinti. **Fix:** kısa overlap (yeni container'ı ikinci portta başlat → `/healthz/ready` geç → nginx upstream'i atomik çevir) veya 2 replica + `proxy_next_upstream`.
- **`/api/health` DB/Redis düşükken HTTP 200 döndürüyor:** `app.service.ts:66,79` yalnızca `status='degraded'` set ediyor, controller throw etmiyor (`app.controller.ts:41-46`). Deploy gate ve container healthcheck DB'sini kaybetmiş backend'i "healthy" sayar (boot-time DB hatası yine de yakalanıyor, ama boot-sonrası DB kaybı görünmez). **Fix:** `status!='ok'`'ta `ServiceUnavailableException` fırlat; ayrı her-zaman-200 liveness route tut.
- **`/healthz/ready` 503 dönmüyor (yorum öyle diyor):** `app.controller.ts:72-129` `@HttpCode` yok, `{ok:false}`'u 200 ile sunuyor. Bunu gate'e bağlayan herkes bozuk backend'i ready sayar. **Fix:** başarısız her dalda `res.status(503)`; 503 assert eden spec ekle.
- **Graceful shutdown Socket.IO Redis pub/sub client'larını sızdırıyor + drain delay yok:** `redis-io.adapter.ts:96-103` `disconnectRedis()` hiç çağrılmıyor; prod'da `stop_grace_period` yok. **Fix:** `disconnectRedis()`'i shutdown'a bağla; pre-stop readiness-fail + kısa drain; `stop_grace_period: 30s`.

**Throttle storage / ölçek**
- **Throttle storage in-memory (Redis yok):** `app.module.ts:82` `storage` yok → per-process `Map`. 2. replika ile sayaçlar N× çoğalır, her deploy'da sıfırlanır. Bugün tek-replica olduğu için latent. **Fix:** mevcut `REDIS_URL` ile `ThrottlerStorageRedis`. (H2 ile aynı modül; önce H2'yi düzelt.) *(cross-cutting: ratelimit/redis/scaling)*

**Realtime / Redis dayanıklılığı**
- **Socket.IO Redis adapter ~3 deneme sonrası kalıcı reconnect'i bırakıyor:** `redis-io.adapter.ts:52-55` retries>3'te `Error` dönüyor → node-redis kalıcı durur, self-recovery yok. Çok-replica'da Redis blip'i pod ömrü boyunca cross-replica realtime'ı koparır (KDS ticket/floor/caller yarı düşer). **Fix:** canlı client'lar için capped-backoff sınırsız reconnect; bounded give-up yalnızca boot denemesinde; adapter `end`/`error`'da metric/alert.
- **Prod Redis tek SPOF + `maxmemory`/eviction yok:** `docker-compose.prod.yml:47` yalnızca `--requirepass`. **Fix:** `--maxmemory <N>mb --maxmemory-policy noeviction` + `mem_limit`; çok-replica öncesi managed/Sentinel Redis.
- **Redis-backed çok-replica yolu staging'de hiç egzersiz edilmiyor:** staging backend'inde `REDIS_URL` yok (`docker-compose.staging.yml:82-90`) → adapter+invalidation bus local-only branch'te; Redis-bağımlı buglar prod'a doğrulanmadan gider. **Fix:** staging backend'ine `REDIS_URL` ver, ideali 2 replica.

**Veri katmanı**
- **Non-CONCURRENT index oluşturma canlı serving DB'ye karşı deploy sırasında çalışıyor:** 49 `CREATE INDEX`'in 46'sı non-concurrent; `deploy.sh:387` migration'ı eski serving container'da uyguluyor. Tablolar büyüdükçe (H9) index-ekleme migration'ı yazmaları durdurur. **Fix:** büyük-tablo index'lerini `CREATE INDEX CONCURRENTLY` ham SQL olarak Prisma transaction'ı DIŞINDA yaz; `lock_timeout` ile fail-fast.
- **Tenant izolasyonu yalnızca app-katmanı (Postgres RLS yok):** yüzlerce sorgu sitesinden birinde kaçırılan `tenantId` filtresi DB-katmanı backstop'u olmadan veri sızdırır. **Fix:** en hassas para/PII tablolarında (orders/payments/customers/invoices/caller_events) `set_config(app.tenant_id)` + Prisma middleware ile RLS; en azından her tenant-scoped repo metodunun `tenantId` predicate içerdiğini assert eden lint/test.

**Güvenlik**
- **Edge'de HSTS / güvenlik header'ları yok; Helmet yalnızca `/api`+`/uploads`'ı kapsıyor:** tüm `ops/nginx/*.conf`'ta `add_header`/HSTS sıfır; SPA HTML ayrı container nginx'inden HSTS/X-Frame-Options/nosniff'siz servis ediliyor. Düşman ağda ilk-ziyaret SSL-strip + dashboard/POS clickjacking. **Fix:** her 443 server bloğuna `Strict-Transport-Security … always` + X-Content-Type-Options/X-Frame-Options/Referrer-Policy snippet'i. *(cross-cutting: security + nginx)*
- **Outbound webhook fetch redirect takip ediyor + doğrulanmış IP pin'lenmiyor → SSRF bypass:** `webhook-delivery-worker.service.ts:176` `fetch(d.url)` `redirect:'manual'`'sız (undici default follow). Tenant'ın kontrolündeki public endpoint 302 ile `169.254.169.254/...`'e yönlendirir; yanıt `text.slice(0,500)` olarak dashboard'da görünür → IMDS/iç-veri exfiltrasyonu. **Fix:** `redirect:'manual'` + 3xx'i failure say; tam kapsama için undici Agent ile doğrulanmış IP'yi connect-time'a pin'le. (high — yetkili tenant gerekir ama self-serve webhook normal özellik.)
- **`trust proxy=1` ama Cloudflare→nginx 2-hop → gerçek client IP kayıp:** `main.ts:58-64` default 1; nginx'te `set_real_ip_from`/`CF-Connecting-IP` yok → `req.ip` = Cloudflare edge IP. Throttle bucket'ları (`machine-throttler.guard.ts:21`), audit IP'leri (`client-ip.helper.ts:12`), PayTR allowlist fallback (`paytr-ip-allowlist.guard.ts:77`) yanlış IP görüyor. **Fix:** nginx'e CF `set_real_ip_from <CIDR>; real_ip_header CF-Connecting-IP; real_ip_recursive on;`, sonra `TRUST_PROXY`'yi doğru hop sayısına ayarla. *(B4 ile birlikte X-Forwarded-For sahteciliğini de kapatır.)*
- **Edge'de rate-limit (`limit_req`/`limit_conn`) yok:** tek origin koruma app-throttler (H2 ile zaten kırık + yanlış IP keying). Origin Node event-loop/DB pool'u volümetrik flood'a açık. **Fix:** gerçek client IP ile (H'den sonra) `limit_req_zone`/`limit_conn_zone`, `/api/auth` + webhook'larda daha sıkı.

**Container hardening / supply chain**
- **Hiçbir container'da `cap_drop`/`no-new-privileges`/read-only rootfs yok** (prod+staging); nginx ve alertmanager root. Backend zaten non-root + izole volume olduğu için medium. **Fix:** tüm servislere `security_opt: [no-new-privileges:true]` + `cap_drop: [ALL]`; nginx/alertmanager non-root.
- **Prometheus(9090)/Alertmanager(9093) `0.0.0.0`'da authsuz:** `docker-compose.monitoring.yml:61-62,103-104`. Opt-in stack olsa da çalıştırılırsa authsuz API + silence-oluşturma (alert bastırma). **Fix:** `127.0.0.1:`'e bind veya authenticated nginx vhost; alertmanager non-root.
- **Log-driver/rotation yok:** default json-file sınırsız büyür → disk dolunca Postgres WAL yazamaz, DB düşer. **Fix:** her servise `logging: json-file max-size:10m max-file:5` veya daemon-wide default.
- **File log'ları ephemeral container path'ine yazıyor (volume/shipping yok):** `LOG_TO_FILE=true` ama `/app/logs` volume'ü yok → her deploy'da kayıp; merkezi log store yok → olay-sonrası adli inceleme imkânsız. **Fix:** `/app/logs` named volume + stdout'u managed log backend'e ship.
- **Monitoring/alerting prod'da çalışmıyor:** `docker-compose.monitoring.yml` opt-in, `deploy.sh`/prod compose'da referans yok; alert.rules mükemmel ama kimse scrape etmiyor. DLQ büyümesi/payment-failure/backend-down sessiz. (Sentry crash görünürlüğü kısmen var ama metrik-tabanlı koşulları kaçırır.) **Fix:** prometheus+alertmanager'ı prod compose/deploy'a kat veya managed alternatif; `ALERT_WEBHOOK_URL`'i gerçek on-call'a; "always-firing" watchdog ekle.
- **Outbox backlog/worker-liveness monitoring yok:** tek alert `OutboxDLQNonEmpty`; worker tamamen dururken satırlar `queued`'da birikir, DLQ 0 kalır, alert ateşlenmez (`alert.rules.yml:25`). Para/entitlement event'leri sessizce gecikir. **Fix:** queued-depth + oldest-pending-age gauge'ları, `outbox_events_reclaimed_total` rate>0 alert'i, eşik-aşımı alert'leri.

**Observability doğruluğu**
- **Structured Winston logger app logger DEĞİL:** `main.ts` `app.useLogger()` çağırmıyor; 144 `new Logger()` plain-text + requestId/tenantId'siz log üretiyor (`logger.service.ts` yalnızca 3 yerde inject). Çok-tenant olayında tek tenant/request trace'i çekilemez. **Fix:** `NestFactory.create(AppModule,{bufferLogs:true})` + `app.useLogger(app.get(LoggerService))`.
- **Sentry v10 AppModule import'undan SONRA init ediliyor:** `main.ts:4` AppModule, `:23` `initSentry()` → auto Prisma/HTTP span instrumentation patch'lenemiyor (manuel span'lar + error-capture yine çalışıyor). **Fix:** ayrı `instrument.js`'i `node --import` ile ilk yükle + `@sentry/nestjs`.
- **`SENTRY_DSN` opsiyonel, boot-warning yok:** `env-validation.ts:57` `required:false`; eksikse `console.log` (warn değil) + tüm 5xx capture no-op. **Fix:** prod'da zorunlu kıl (EMAIL_* gibi) veya yüksek-sesli banner + template'e ekle.
- **Exception-filter requestId taze random, korelasyon-id değil:** `http-exception.filter.ts:31` `generateRequestId()`; yanıt body, X-Request-Id header, access log, Sentry tag'i farklı id'ler gösteriyor → 5xx korelasyonu kopuk. **Fix:** `RequestContext.getRequestId()` kullan.

**Supply chain**
- **SCA scanning / Dependabot yok:** `npm audit --omit=dev` prod ağacında backend 3 critical+55 high, frontend 1 critical+6 high raporluyor; CI `--no-audit` ile suppress. Auth/payment yolundaki yeni CVE'ler hiç işaretlenmez. **Fix:** blocking `npm audit --omit=dev --audit-level=high` (veya Trivy/osv-scanner) job'u + Dependabot/Renovate haftalık gruplu PR'lar; transitive/dev-only'i allowlist'le.
- **Rust `Cargo.lock` gitignored:** `.gitignore:69` `Cargo.lock` → 4 binary crate (bridge-agent, desktop, kiosk, frontend) lockfile'sız, CI `--locked`'sız non-reproducible build + Rust tarafında sıfır vuln-scan. bridge-agent device-mesh'e auth ediyor, desktop POS/printing yapıyor — güvenlik-hassas distributable'lar. **Fix:** lockfile'ları commit'le, `cargo build --locked`, `cargo-audit`/`cargo-deny` CI step'i. (kiosk için önce `cargo generate-lockfile`.)
- **Backend prod artifact `npm install` ile derleniyor (`npm ci` değil):** `backend/Dockerfile:20` build stage'i `^`-range'leri taze çözer → shipped `dist/` lockfile'dan sapabilir, immutable-tag garantisini zayıflatır. **Fix:** build stage'ini `npm ci`'ye çevir; prod stage `npm ci --omit=dev`; `prisma`'nın runtime varlığını explicit kıl.

---

## 6. ⚪ Hardening backlog (low/info)

- **Legacy kök `deploy.sh`** interaktif + DB-yıkıcı + `/opt/kds` (mevcut değil) → operatör yanlış script çalıştırabilir. **Fix:** sil veya `scripts/deploy.sh`'a exec-shim.
- **Public `/api/health`** version/environment/uptime sızdırıyor (`app.controller.ts:41-46` `@Public`). **Fix:** minimal tut; detaylı/ready endpoint'leri internal-network'e kısıtla.
- **Backend full Debian `node:20` (2.96GB):** pull süresini ve OS attack-surface'ini şişiriyor. **Fix:** `node:20-slim`.
- **Base image'lar digest değil tag-pinned; frontend EOL `node:18`:** rebuild'de OS-CVE/runtime sürüklenmesi. **Fix:** digest-pin + node:20-alpine'a hizala + Trivy.
- **`developer/`+`help/` `.dockerignore` zayıf** (yalnızca `.env*.local`) → gelecekte `.env` image'a sızabilir. **Fix:** backend pattern'i (`.env`/`.env.*` exclude, `!.env.example`).
- **`SENTRY_AUTH_TOKEN` build-arg + registry cache(mode=max)** ile geçiyor (public registry). **Fix:** BuildKit secret + token rotate.
- **OpenTelemetry tracing ölü kod** (`bootstrapTracing()` hiç çağrılmıyor, `OTEL_*` env'leri prod compose'da boşuna). **Fix:** ilk-satır bootstrap + paketler, ya da `tracing.ts`+env'leri sil.
- **Access log'ları client IP anonimleştirmeden tutuyor** (KVKK PII) — e-posta scrub edilirken IP edilmiyor. **Fix:** son-oktet truncate / hash, veya bilinçli kabul-kararı dokümante et.
- **Shipped env template'leri drifted** (`ENCRYPTION_MASTER_KEY`/`SUPERADMIN_*`/`INTEGRATION_KEY`/`REDIS_PASSWORD` eksik, ölü Stripe, `PAYTR_TEST_MODE=false`) → şablondan kurulum boot-abort. **Fix:** CI render bloğundan yeniden üret.
- **Rendered `.env.production` `REDIS_URL`** compose-injected'la çelişiyor (parolasız db0 vs db2) — ölü değer, bakım tuzağı. **Fix:** tek owner seç.
- **`DESKTOP_RELEASE_API_KEY` staging+prod paylaşımlı** + leaked. **Fix:** ayrı `STAGING_*` + prod'u rotate.
- **OTP hash secret `?? ""` fallback'i** (`customers.helpers.ts:55`) — JWT_SECRET yoksa tuzsuz sha256. **Fix:** yoksa throw / ConfigService.
- **Customer OTP SMS prod'da sessizce mock** (`ALLOW_MOCK_SMS_IN_PROD=true`) — bugün tek caller dead-code, ama UI bağlanırsa sessiz OTP-kaybı. **Fix:** OTP launch'ında `NETGSM_*` set + flag kapat + required'a yükselt.
- **ValidationPipe `forbidNonWhitelisted:false`** — over-post sessizce strip; register `role`/`tenantId` ile pending-staff phishing. **Fix:** `forbidNonWhitelisted:true` + register'ı invite-token ile gate.
- **Demo-reset cron'unda advisory-lock yok** (`demo.service.ts:343`) — çok-replica'da eşzamanlı; yalnızca demo tenant etkili. **Fix:** `withAdvisoryLock`'a sar (H1'den sonra).
- **Node PID 1, init yok** — zombie reaping / sinyal-forwarding edge case'leri. **Fix:** `tini`/`dumb-init` entrypoint.
- **nginx'te gzip/brotli yok, proxy timeout/keepalive/upstream-failover yok, `client_max_body_size 25m` < 50MB batch-upload tavanı.** **Fix:** edge compression + per-service `upstream{}` + timeout'lar + upload-scoped body-size hizalaması.
- **QR/PDF/image üretimi request handler'ında senkron** (`qr.service.ts:178-220` ~500ms/PNG × 500) — tek event-loop'u bloklar. **Fix:** BullMQ (mevcut Redis) ile background queue.
- **Reports sınırsız tarih-aralığı** (`reports.service.ts:168-194`) — çok-yıllık rapor satırları JS'e yükler. **Fix:** max-pencere cap + SQL `date_trunc` bucketing.
- **Prod vhost "reconstructed" + canlıya karşı doğrulanmamış** (`hummytummy.com.conf:4-12`). **Fix:** `nginx -T` capture'ını commit'le, `apply.sh` ile senkronize tut.

---

## 7. Önerilen aksiyon planı

### Bu hafta (GO-LIVE'dan önce — gerçek tenant almadan ŞART)
1. **B1 — Secret'ları döndür** (en yüksek tek-aksiyon değer; history-purge'den bağımsız). JWT/refresh önce → kimlik-sahteciliğini anında kapatır. Aynı pencerede repoyu re-private + `git filter-repo` (B1+B3 birlikte, aktif session'larla koordine).
2. **B4 — Container'ları `127.0.0.1`'e bind et + host firewall codify.** Tek satır + ufw; doğrudan-origin yüzeyini kapatır (H6/throttle/trust-proxy maruziyetini de daraltır).
3. **B3 — `backups/`'ı git'ten çıkar** (B1 purge'üne dahil), `BACKUP_DIR`'i repo dışına taşı.
4. **B2 + H4 — Offsite + zamanlanmış yedek** (cron/systemd + `rclone`/`s3 cp` + stale-backup alert). İkisi birlikte küçük efor, en büyük DR boşluğunu kapatır.
5. **H3 — Restore runbook + drill** (en az manuel `gunzip|psql` runbook'u; `.sql.gz` uyumsuzluğunu düzelt). Yedeğin gerçekten geri-yüklendiğini bir kez kanıtla.
6. **H2 — `default` throttler'ı register et** + login 429 integration test. Tek satır fix, auth brute-force'u tekrar silahlandırır.
7. **H6 — `METRICS_TOKEN` zorunlu + nginx `/api/metrics` deny.**

### Ölçeklenmeden önce (2. replica / ilk gerçek yük öncesi)
8. **H1 — Advisory-lock'u `pg_advisory_xact_lock` + tek-`tx`'e taşı** (5 inline scheduler dahil) + çok-tick gerçek-Postgres test. Throttle/upload/realtime ölçek-fix'lerinin ÖNCESİNDE — billing/webhook cron sessiz-durmasını kapatır; tek-replica'da bile geçerli.
9. **H5 — Compose-native `mem_limit`/`cpus` + `NODE_OPTIONS` heap cap** (postgres/redis rezervli). Paylaşılan-DB OOM'unu kapatır.
10. **H8 + Medium statement_timeout/idle-tx + non-concurrent index** — birlikte; pool-tükenmesi ve deploy-sırası index-kilidini önler.
11. **H9 — Append-tablo retention pruner'ları** (advisory-lock fix'inden sonra). Yük büyümesinin ilk darboğazını geciktirir.
12. **DATABASE_URL pool-override fix + `connection_limit` boyutlama + (≥3 replica öncesi) pgbouncer** — H1'le aynı veri-katmanı pass'inde.
13. **Throttle storage → Redis** (H2'den sonra), **Socket.IO adapter capped-backoff reconnect**, **staging'e `REDIS_URL`** — çok-replica realtime/limit doğruluğu üçlüsü.
14. **Tek-replica 502 penceresini kapat** (overlap swap veya 2 replica + `proxy_next_upstream`) + graceful-shutdown drain + `stop_grace_period`.
15. **H7 — Device/bridge token slide-on-heartbeat** (mesh'i açacak tenant'lar öncesi).
16. **Monitoring'i prod'a kat + `ALERT_WEBHOOK_URL` + watchdog + outbox-backlog/worker-liveness gauge'ları** — ikinci olaydan önce sessiz-başarısızlığı görünür kıl.

### Sürekli (ship-edip-devam)
17. **SCA gate + Dependabot/Renovate** (blocking `npm audit --audit-level=high`) + öncelikli paket bump'ları: axios, jws (auth), express-rate-limit, ws/socket.io (realtime), multer (upload). **Rust `Cargo.lock` commit + `cargo-audit`.**
18. **Observability doğruluğu:** Winston'ı app logger yap, Sentry'i `--import` ile ilk-yükle + DSN prod-required, exception-filter requestId'yi `RequestContext`'e bağla.
19. **Güvenlik defense-in-depth:** edge HSTS/güvenlik-header snippet'i, CF real-IP + `TRUST_PROXY`, webhook fetch `redirect:'manual'` + IP-pin, container `cap_drop`/`no-new-privileges`, en hassas tablolarda RLS.
20. **Hygiene:** log-rotation, `/app/logs` volume + ship, legacy `deploy.sh` sil, `node:20-slim` + digest-pin + frontend node:18→20, env template'leri yeniden üret, OTel ya bağla ya sil, `forbidNonWhitelisted:true`.

**Bağımlılık notu:** H1 (advisory-lock) → H9 retention pruner'ları ve demo-reset lock'undan ÖNCE (bu job'lar düzeltilmiş kilide dayanır). H2 (default throttler) → throttle-storage-Redis'ten ÖNCE. B1 secret-rotation → history-purge'le aynı koordineli pencerede. CF real-IP → edge `limit_req`'ten ÖNCE (yanlış IP'ye limit koymak işe yaramaz).