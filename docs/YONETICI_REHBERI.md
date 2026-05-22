# KDS Yönetici (Satış Müdürü) Rehberi

Bu döküman, **Satış Müdürü** (`SALES_MANAGER`) rolüne sahip ekip yöneticileri içindir. Hedef: yeni gelen lead'leri pazarlamacılarına nasıl dağıtacağını, görev sistemini nasıl kullanacağını, komisyon onaylarını ve günlük disipline ait pratikleri tek bir yerden öğrenmek.

Pazarlamacı tarafının ne gördüğünü merak ediyorsan: `PAZARLAMACI_REHBERI.md` dosyasına bak — bu rehber onu tamamlar.

---

## 1. Senin Rolün Nedir?

KDS pazarlama panelinde iki rol vardır:

| Rol | Ne yapar? | Ne yapamaz? |
|---|---|---|
| **Satış Temsilcisi** (`SALES_REP`) | Kendi lead'lerini görür, durumlarını günceller, görev oluşturur, teklif gönderir, komisyonunu izler | Başkasının lead'ini göremez, lead atayamaz, dağıtım stratejisi değiştiremez, komisyon onaylayamaz, lead silemez |
| **Satış Müdürü** (`SALES_MANAGER`) — **sen** | Tüm ekibin lead'lerini görür, lead atar / yeniden atar, otomatik dağıtım stratejisi seçer, komisyonları PENDING → APPROVED → PAID akışından geçirir, atanmamış lead bekletme kuyruğunu yönetir, lead siler | — |

Pratikte sen ekibin **trafik kontrol kulesisin**: gelen lead'i doğru pazarlamacıya yönlendirir, kimsenin önünde sıkışan ya da kimsenin elinde unutulan kayıt kalmamasını sağlarsın.

---

## 2. Yönetici Paneli Turu (`/marketing`)

Pazarlamacının gördüğü her sayfa sende de var, **ek olarak** şu yetkilerle:

| Sayfa | Sende fazladan ne var? |
|---|---|
| **Dashboard** | "Atanmamış Lead" tile (kırmızı/sarı/yeşil renk), "En iyi performans" lider tablosu |
| **Leads** | "Atanmamış / Atanmış / Bana atanmış" filtreleri, satır seçimi ile toplu işlem toolbar'ı, her satırda inline "Ata" butonu |
| **Lead Detail** | "Atamayı Kaldır" / "Yeniden Ata" butonu, dönüşüm (Convert to Tenant) aksiyonu, silme |
| **Tasks** | Ekibin tamamının görevlerini görürsün, görev silebilirsin |
| **Ekip** (Users) | Otomatik dağıtım stratejisi konfigürasyon kartı, yeni pazarlamacı ekleme / deaktive etme |
| **Commissions** | PENDING komisyonları APPROVE / REJECT, APPROVED'ları MARK PAID |
| **Reports** | Tüm ekibin funnel'ı, bölgesel performans, kaynak dağılımı |

---

## 3. Lead Atama: 3 Yöntem

Yeni bir lead sisteme girdiğinde (manuel kayıt, AI ingest, referral) **birinin önünde olması** gerekir. Aksi halde "atanmamış lead" kuyruğunda bekler. Dağıtmanın 3 farklı yolu vardır.

### Yöntem 1 — Inline Tek Atama (En Sık Kullanılan)

**Nerede:** `Leads` sayfasında her satırın **"Ata"** sütunu var. Hücreye tıkla.

**Akış:**

1. Hücreye tıkla → pazarlamacı listesi açılır.
2. **"Temsilci ara…"** alanından ad yaz veya listeden seç. Sadece **aktif** durumdaki satış temsilcileri görünür.
3. Seçince ekrana **"Lead atandı"** toast'ı düşer; satır anında güncellenir.
4. Pazarlamacıya otomatik bildirim gider (4. bölüme bak).

**Atamayı geri almak:**

- Aynı hücreye tıkla → açılır panelde **"Atamayı Kaldır"** butonuna bas. Lead atanmamış kuyruğuna geri döner.

**Ne zaman:** 1-3 lead'i farklı kişilere dağıtırken. Mobile dahil her ekranda çalışır (mobil'de sütun gizli; satır detayında aynı kontrol).

### Yöntem 2 — Toplu Atama (Bulk Dispatch)

**Nerede:** Leads sayfasında satırların başındaki checkbox'lardan seçim yap → üstte yapışkan toolbar belirir.

**Akış:**

1. Checkbox ile 1-200 lead seç (bir seferde max 200).
2. Toolbar'da **"{X} lead seçildi"** ve **"Toplu Ata"** butonu görünür.
3. **"Toplu Ata"** → aynı arama paneli açılır, pazarlamacı seç.
4. Sistem tek bir transaction'da atar; sonuçta `{ atanan, atlanan, değişmeyen }` özetini gösterir.
5. Pazarlamacıya **tek bir özet bildirim** gider (N tane ayrı bildirim değil): "Sana 17 yeni lead atandı — Ahmet Kafe, Berke Restoran ve 15 diğer".

**Toolbar görünmüyor mu?** Seçim yapmamışsındır. **"Seçimi temizle"** butonu seçimi sıfırlar.

**Ne zaman:**

- Sabah atanmamış kuyruğunu boşaltırken (kırmızı tile uyarıyor).
- Bir pazarlamacı izne ayrıldığında onun lead'lerini başkasına devrederken (önce filtre ile o kişinin lead'lerini seç → toplu ata).
- AI ingest ile gelen büyük listeyi bölüştürürken.

**Kısıtlar:**

- Tek istekte max 200. Daha fazla varsa 2 partide gönder.
- Aynı kişiye zaten atanmış lead'ler "değişmeyen" sayılır, tekrar bildirim gitmez (gereksiz spam yok).

### Yöntem 3 — Otomatik Dağıtım (Set-and-Forget)

**Nerede:** `Ekip` (Users) sayfası → **"Otomatik Lead Dağıtımı"** kartı.

**3 strateji:**

| Strateji | Ne yapar? | Ne zaman seç? |
|---|---|---|
| **Kapalı (manuel dağıtım)** | Yeni lead'ler atanmamış olarak bekler, sen elle atarsın | Küçük ekip (2-3 kişi), her lead'i sen gözle ayırmak istiyorsun, lead kalitesi farklı (premium müşteri = en iyi pazarlamacı) |
| **Sırayla (Round-Robin)** | Aktif pazarlamacı listesinden sırayla seçer; her atama sonrası imleç ilerler | Lead kalitesi homojen, ekip eşit performansta, adaletli paylaşım istiyorsun |
| **En Az Yüklü Temsilci** | Kimin açık (WON/LOST olmayan) lead'i azsa ona verir; eşitlikte en eski oluşturulmuş öncelikli | Pazarlamacılar farklı hızlarda kapatıyor, yığılma olmamasını istiyorsun |

**Akış:**

1. Karta git → radio'lardan strateji seç → otomatik kaydedilir.
2. Bundan sonra **yeni gelen** lead'ler kurala göre atanır.
3. **Mevcut atanmamış lead'lere etkisi yoktur** — onları toplu ata ile dağıtmalısın.

**Manuel atama her zaman kazanır.** Round-robin açık olsa bile sen elle başkasına atarsan o atama geçerli olur, kural overwrite edilmez.

**Round-robin notu:** İmleç atomik ilerler ama aynı anda iki lead gelirse aynı kişiye düşebilir (kısa pencere). Adaletsizlik birikmez; bir sonraki turda telafi olur.

**Tavsiye:** İlk ay **Kapalı** ile başla, ekibini gözle. 2. ay **En Az Yüklü** aç. Pazarlamacılar eşit kapasiteye geldiğinde **Round-Robin**'e geç.

---

## 4. Atamadan Sonra Ne Olur?

Bir lead'i birine attığında arka planda:

1. **`LeadActivity` audit kaydı** açılır — "kim, kime, ne zaman atadı" sonsuza dek loglanır. Lead Detail'de aktivite zaman çizelgesinde görürsün.
2. Eğer hedef kişi **sen değilsen** (sen kendine atamadıysan):
   - O pazarlamacının panelinde **bildirim** belirir (sağ üst zil).
   - Başlık: *"Sana yeni bir lead atandı"* veya toplu için *"Sana X yeni lead atandı"*.
   - Bildirim metadata'sında `leadId` ve `assignedBy` (senin ID'n) tutulur — yanlış atama hatasında geriye dönüp izini sürebilirsin.
3. Lead'in `assignedToId` alanı güncellenir; pazarlamacı kendi listesinde anında görür.
4. Aynı kişiye zaten atanmış bir lead'i tekrar ona atarsan **hiçbir şey olmaz** (no-op) — audit kirletilmez, gereksiz bildirim atılmaz.

**Yeniden atama (re-assign):** Aynı `Ata` hücresinden farklı bir pazarlamacı seç. Eski kişiye "elinden alındı" bildirimi gitmez (sessiz transfer), yeni kişiye "sana atandı" bildirimi gider. İsteğe bağlı olarak eski kişiyi WhatsApp'tan haberdar et — sistem otomatik haber vermez.

---

## 5. Atanmamış Lead Kuyruğu (Dashboard Tile)

Dashboard'unda **"Atanmamış Lead"** sayacı vardır. Renk kodlu:

| Renk | Sayı | Anlamı | Aksiyonun |
|:---:|:---:|---|---|
| Yeşil | 0 | Tertemiz, hiçbir lead beklemiyor | Devam et |
| Sarı | 1–10 | Dikkat — biriken var | Gün içinde dağıt |
| Kırmızı | 10+ | Birikmiş — pazarlamacılar bekleniyor | Hemen toplu ata |

Tile'a tıklarsan otomatik olarak `Leads?assignmentStatus=unassigned` filtresi ile açılır — direkt toplu seçim yapıp dağıtabilirsin.

**Pratik:** Her sabah ofise girince ilk işin bu tile'a bakmak. Kırmızıysa 5 dakika ayır, toplu ata.

---

## 6. Görev (Task) Sistemi

### Görev ≠ Lead'i Aramak

Görev sistemi **bağımsız bir hatırlatıcı altyapısıdır**. Bir görev:

- Lead'e bağlı **olabilir** (`leadId` opsiyonel) — "Cuma Ahmet Kafe'yi ara".
- Lead olmadan da olabilir — "Pazartesi ekip toplantısı", "Vergi dairesine git".

### Görev Tipleri

| Tip | Ne için? |
|---|---|
| **CALL** (Telefon) | Soğuk arama, takip araması |
| **VISIT** (Ziyaret) | Saha ziyareti — bir kategoridir, otomatik kayıt değildir |
| **DEMO** | Ürün demosu randevusu |
| **FOLLOW_UP** (Takip) | Genel takip — teklif sonrası, ziyaret sonrası |
| **MEETING** (Toplantı) | İç ekip toplantısı veya müşteri ile yüz yüze |
| **OTHER** (Diğer) | Sınıflandırılamayan |

### Görev Öncelikleri

`LOW` → `MEDIUM` → `HIGH` → `URGENT`. Renk kodlu görünür, sıralamada kullanılır.

### Görevler Sayfası (`/marketing/tasks`)

Üst sekmeler:

- **"Tümü"** — ekibin tüm görevleri (sen müdür olarak hepsini görürsün; pazarlamacı sadece kendininkini)
- **"Bugün"** — bugün vadesi gelen
- **"Gecikmiş"** — vadesi geçmiş ama tamamlanmamış (kırmızı tarih)

**Hızlı ekleme formu** üstte: başlık, tip, öncelik, son tarih, açıklama, opsiyonel olarak hangi lead'e/kime bağlı.

**Görev durumları:**

- **PENDING** (Bekliyor) — yeni oluşturulmuş
- **IN_PROGRESS** (Devam ediyor) — pazarlamacı işe başladığında play ikonuna basar
- **COMPLETED** (Tamamlandı) — checkbox tıklanır, üstü çizilir

### Yöneticinin Görev Yetkileri

- **Görmek:** Ekipteki herkesin tüm görevlerini görürsün — kim ne yapıyor anında bellidir.
- **Oluşturmak:** Kendine veya bir pazarlamacıya görev atayabilirsin (`assignedToId` alanı). "Salı sabah Berke Restoran'a uğra" → atadığın kişinin paneline düşer.
- **Silmek:** Sadece müdür silebilir. Pazarlamacı görevini sadece tamamlayabilir/güncelleyebilir, silemez.
- **Takvim görünümü:** `/marketing/calendar` üzerinden tüm ekibin görevini aylık olarak gör.

### Görev → Lead Bağlantısı

Görev oluştururken `leadId` seçersen:

- Lead Detail sayfasında "Görevler" sekmesine düşer.
- Lead'in geçmişinde "kim ne zaman bu lead için ne yaptı" gözüküyor.
- Görev tamamlandığında lead aktivitesi de güncellenir.

**Pro ipucu:** Pazarlamacılarına "her arama Activity, her gelecek aksiyon Task" disiplini öğret. Activity = geçmiş kayıt, Task = gelecek hatırlatıcı. İkisi karıştırılırsa pipeline yarı görünür kalır.

---

## 7. Komisyon Onay Akışı (Senin İmzanla Para Akar)

Sistem otomatik komisyon **hesaplar** ama otomatik **ödeme** yapmaz. Senin onayın olmadan pazarlamacının cebine bir kuruş girmez. Bu kasıtlı bir kontrol — şeffaflık + suistimal önleme.

### Akış

```
SIGNUP / RENEWAL / UPSELL ödemesi olur
   ↓
Sistem otomatik commission yazar (PENDING)
   ↓ ← sen burada APPROVE / REJECT karar verirsin
APPROVED (kazanç onaylı, muhasebeye gider)
   ↓ ← sen burada MARK PAID dersin (havale yapıldı)
PAID (bitti, panelde "ödendi" görünür)
```

### Commissions Sayfasında Ne Yapıyorsun?

1. **Liste filtrele:** PENDING'leri gör.
2. **Her satırda detay modal:** Hesaplama (`Ödenen × Oran`), bağlı lead, plan, dönem, tutar.
3. **Şüpheli bir şey yoksa APPROVE.** Şüpheliyse (örn. iade alınmış müşteri) REJECT — pazarlamacıya komisyon yazılmaz.
4. **Ay sonu (veya belirlediğin sıklık):** APPROVED'ları toplu seçip MARK PAID — pazarlamacının panelinde de "ödendi" olur.

### Şüpheli İşlem Örnekleri

- Aynı müşteri trial'da iptal etmiş, sonra başka bir kart ile tekrar gelmiş → çift commission yazılmış olabilir. Detay'da `convertedTenantId` kontrol et.
- PayTR refund'ı sonrası RENEWAL komisyonu yazılmış → REJECT, refund ile geri al.
- UPSELL ama plan aslında downgrade — sistem nadir yanlış işaretler; manuel düzelt.

### Audit Log

Her durum değişikliği (PENDING → APPROVED, APPROVED → PAID, herhangi → REJECTED) `auditLog` tablosuna düşer: kim, ne zaman, hangi tutar, hangi `commissionId`. Modal'daki timeline'da görünür. Pazarlamacı itiraz ederse buradan kanıtlarsın.

---

## 8. Ekip Yönetimi (`/marketing/users`)

### Yeni Pazarlamacı Ekleme

1. **"Yeni Temsilci"** butonu → form (ad, e-posta, telefon, rol = SALES_REP).
2. Sistem geçici şifre üretir, e-postaya gönderir.
3. Pazarlamacı ilk girişte şifresini değiştirir.

### Deaktive Etme

Pazarlamacı ayrılırsa: profilinden **status = INACTIVE**.

- O kişi panele giremez.
- "Ata" hücresinden artık seçilemez (sadece ACTIVE'ler görünür).
- Mevcut atanmış lead'leri **hâlâ ona ait gözükür**. Önce o lead'leri başka birine **toplu ata**, sonra deaktive et.
- Komisyonları silinmez, geçmiş kayıt olarak kalır.

### Referans Kodu Yenileme

Pazarlamacının kodu sızdırıldıysa profil sayfasından **"Kodu Yenile"** — eski kod ölür, yeni kod aktif olur. Eski koddan yeni kayıt gelmez ama eski satışların komisyonu akmaya devam eder (link kişiye değil, satış kaydına bağlı).

---

## 9. Filtre Linkleri ile Takım Yönetimi

Leads sayfasındaki filtreler URL'e yansır. Bunları **kalıcı link** olarak Slack/WhatsApp'a paylaşabilirsin:

| Senaryo | Link |
|---|---|
| Atanmamış kuyruğu | `/marketing/leads?assignmentStatus=unassigned` |
| Bana atanmış olanlar | `/marketing/leads?assignmentStatus=mine` |
| Tüm atanmışlar | `/marketing/leads?assignmentStatus=assigned` |
| Bu hafta yeni gelenler | `/marketing/leads?dateFrom=2026-05-18` |
| WAITING durumunda 7 gündür hareket etmeyen | filtre kombinasyonu — kendi link'ini hazırla |

**Pratik kullanım:**

- Pazartesi sabah ekip toplantısında: *"Şu link'i açın, atanmamış kuyruğu beraber boşaltalım."*
- Yedek pazarlamacıya: *"Bu hafta sonu nöbetçisin, şu link'ten yeni gelenleri sen al."*

---

## 10. Lead Dönüştürme (Convert to Tenant)

Bir lead WON olduğunda **müşteriye dönüştürme** aksiyonu sende:

1. Lead Detail → **"Müşteriye Dönüştür"** butonu.
2. Form: tenant adı (slug), abone olacağı plan, başlangıç planı (trial mi, direkt ödeme mi).
3. Onayla → arka planda yeni `Tenant` + `User` oluşur, müşteriye davet maili gider.
4. `Lead.convertedTenantId` set edilir — aynı lead'den ikinci bir tenant açılamaz (unique constraint).
5. Pazarlamacının komisyonu ilk ödeme yapıldığında otomatik yazılır.

**Hatalı dönüştürme yaptıysan:** Tenant'ı superadmin panelinden silmen + lead'in `convertedTenantId`'sini temizlemen gerekir. Dikkatli ol — kolay geri alınmaz.

---

## 11. Günlük / Haftalık Disiplinler

### Her Sabah (5 dk)

- [ ] Dashboard'da **Atanmamış Lead** tile'ına bak. Kırmızı/sarıysa dağıt.
- [ ] **Bildirim zilini** kontrol et (sistemin sana attığı şeyler — örn. teklif vadesi geçenler).
- [ ] **Bugünün görevleri** sekmesinde kendi görevlerin var mı?

### Her Hafta (30 dk)

- [ ] **Commissions** → PENDING'leri gözden geçir, APPROVE/REJECT.
- [ ] **Reports** → ekip funnel'ı, kim yığılıyor / kim atıl?
- [ ] Pazarlamacılarla **15 dk 1-on-1**: pipeline'larını sor.

### Her Ay (1 saat)

- [ ] **APPROVED komisyonları MARK PAID** (havale günü öncesi).
- [ ] Otomatik dağıtım stratejisini gözden geçir — sayılar göre değişmesi gerekiyor mu?
- [ ] Pazarlamacı performans karşılaştırması: kim BUSINESS satıyor, kim sadece BASIC?
- [ ] LOST reason raporu: en sık reddediliyor olan neden ne, satış argümanı güncellemeli miyim?

---

## 12. Sıkça Sorulan Sorular

**S: Bir pazarlamacıya lead'i atadım, kabul etmiyor / ilgilenmiyor. Geri alabilir miyim?**
C: Evet. Lead'in `Ata` hücresinden başka bir kişiye seç → otomatik yeniden atanır. Eski pazarlamacının panelinden lead düşer, yenisinin paneline gelir. Eski kişiye sistem bildirimi gitmez — WhatsApp'tan sen haber ver.

**S: Otomatik dağıtım açıkken bir lead'i illa belirli bir pazarlamacıya verebilir miyim?**
C: Evet. Manuel atama her zaman kazanır. Lead oluşturduktan sonra hemen "Ata" ile değiştir. Round-robin imleci yine ilerler ama o lead manuel atadığın kişiye gider.

**S: Aynı anda iki pazarlamacı aynı lead'le ilgilenirse?**
C: `Lead.assignedToId` tek bir kişiyi tutar. Yeniden atama yapıldığında eski kişi listeden düşer; aynı anda çoklu sahiplik mümkün değildir. Eğer iki kişinin koordineli çalışmasını istiyorsan görev (Task) olarak ikinci kişiye delege et.

**S: Bir pazarlamacı iptal etmek istediği bir komisyon var diyor. Ne yapayım?**
C: Commissions sayfasında o satırı bul, REJECT. Audit log'a kim ne zaman reddetti düşer. Pazarlamacının panelinde de durum "REJECTED" görünür.

**S: Müşteri abonelikten çıktı (cancel), commission ne olur?**
C: O ana kadar ödenen RENEWAL'lar geçerlidir (zaten ödenmişti). Sonraki ay RENEWAL **otomatik yazılmaz** çünkü ödeme olmuyor. Cancel sebebini lead'in `lostReason` (varsa) ya da tenant notuna düş.

**S: 200'den fazla lead'i toplu atamam lazım. Ne yapayım?**
C: Filtre + sayfa-ı sayfalı ata. Veya checkbox ile partilere böl (ilk 200 → ata, sonra sonraki 200 → ata). API limiti güvenlik için; tek partide çok büyük transaction performansı bozar.

**S: Yeni pazarlamacı eklediğimde aktif mi başlar?**
C: Evet, `ACTIVE` durumunda ve "Ata" listesinde anında görünür. Round-robin sırasına dahil olur. Aktif olmasını istemiyorsan eklemeden önce status'unu INACTIVE seç.

**S: Pazarlamacı kendi lead'ini başkasına atayabilir mi?**
C: Hayır. Atama sadece müdür yetkisindedir. Pazarlamacı kendi lead'ini görüntüleyip durumunu güncelleyebilir, görev/aktivite/teklif ekleyebilir — ama transfer kararı sende.

**S: Lead silmem ne anlama gelir?**
C: Lead kaydı + bağlı activity/task/offer kayıtları silinir (cascade). Geri alınamaz. Sadece test/spam kayıtları için kullan. Gerçek müşteri için `LOST` + `lostReason` yeterlidir.

**S: Reports sayfası sadece bende var mı?**
C: Bazı raporlar (top performers, lead distribution by region) sadece müdüre özel. Pazarlamacı kendi performans raporunu görür ama ekibin geneline erişemez.

---

## 13. Acil Durumlar

- **Bir pazarlamacı ayrıldı, lead'lerini taşıyamadım** → Önce filtre ile o kişinin lead'lerini bul (`assignedToId={user}`), toplu ata ile başka birine devret, sonra deaktive et. Sıralama önemli; deaktive ettikten sonra "Ata" hücresinde gözükmez ama lead'leri hâlâ ona ait kalır.
- **Yanlış kişiye toplu ata yaptım** → Geri alma butonu yok. Tek tek (veya toplu) doğru kişiye yeniden ata. Audit log her iki atamayı da gösterir; gerçek geçmişin bozulmaz.
- **PayTR çift commission yazmış** → Commissions detay'da `paymentId` aynı mı bak. Yanlışı REJECT et, doğru olanı APPROVE.
- **Pazarlamacı şifresini unuttu** → Kullanıcı profili → "Şifre sıfırlama maili gönder". Veya superadmin panelinden manuel reset.
- **Dağıtım yanlış çalışıyor (her şey aynı kişiye gidiyor)** → Stratejiyi DISABLED yap, sorunu rapor et (auto-assigner servisinde aktif rep listesi yanlış filtreleniyor olabilir). Geçici olarak manuel ata.

---

*Bu rehber canlı bir dökümandır. Yeni dağıtım stratejisi, komisyon kuralı veya UI değişikliği geldiğinde güncellenir. Son güncelleme: 2026-05-22.*
