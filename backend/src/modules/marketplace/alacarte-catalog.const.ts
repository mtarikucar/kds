import { LICENSE_ADDON_CODE } from "./catalog-validation";

/**
 * The à-la-carte product catalog — the single source of truth shared by the
 * seed (`prisma/seeds/seed-marketplace.ts`), the catalog data migration, and
 * the invariant specs.
 *
 * Sharing matters: a price that exists only in the seed means a fresh
 * developer database and production charge different amounts for the same
 * product, and nothing catches it until a customer complains.
 *
 * Codes are IMMUTABLE and never reused, so rows that already existed keep
 * their original code even where a tidier name suggests itself
 * (`advanced_reports`, not `module_reports`). Retired products are ARCHIVED,
 * never deleted — `TenantAddOn.addOnId` is onDelete: Restrict.
 *
 * Prices are KDV-INCLUSIVE kuruş, per licensing cycle for `annual` rows and
 * flat for `oneTime` rows. They are superadmin-editable at runtime; these are
 * the launch defaults.
 */

export interface AlaCarteProduct {
  code: string;
  /** Fallback name/description — the tr values, used when i18n misses. */
  name: string;
  description: string;
  kind:
    | "license"
    | "module"
    | "integration"
    | "capacity"
    | "credit"
    | "service";
  billing: "annual" | "oneTime";
  priceCents: number;
  grants: Record<string, boolean | number | string[]>;
  deps: string[];
  requiresLicense: boolean;
  creditKind?: "PHOTO" | "VIDEO" | "MODEL3D" | "SMS";
  creditUnits?: number;
  maxQuantity?: number;
  sortOrder: number;
  i18n: Record<string, { name: string; description: string }>;
}

const t = (
  tr: [string, string],
  en: [string, string],
  ru: [string, string],
  ar: [string, string],
  uz: [string, string],
) => ({
  tr: { name: tr[0], description: tr[1] },
  en: { name: en[0], description: en[1] },
  ru: { name: ru[0], description: ru[1] },
  ar: { name: ar[0], description: ar[1] },
  uz: { name: uz[0], description: uz[1] },
});

export const ALACARTE_CATALOG: AlaCarteProduct[] = [
  // ---------------------------------------------------------------- LICENSE
  {
    code: LICENSE_ADDON_CODE,
    name: "HummyTummy Lisansı",
    description:
      "Ücretli modülleri satın alabilmek ve kullanabilmek için gereken yıllık lisans. Satın alma tarihi hesabınızın yıl dönümü olur; sonradan aldığınız her modül bu tarihe orantılı fiyatlanır.",
    kind: "license",
    billing: "annual",
    priceCents: 299_000,
    grants: { "feature.license": true },
    deps: [],
    requiresLicense: false,
    sortOrder: 0,
    i18n: t(
      [
        "HummyTummy Lisansı",
        "Ücretli modülleri satın alabilmek ve kullanabilmek için gereken yıllık lisans. Satın alma tarihi hesabınızın yıl dönümü olur.",
      ],
      [
        "HummyTummy Licence",
        "The annual licence required to buy and use any paid module. Its purchase date becomes your account anniversary.",
      ],
      [
        "Лицензия HummyTummy",
        "Годовая лицензия, необходимая для покупки и использования любого платного модуля. Дата покупки становится годовщиной вашего аккаунта.",
      ],
      [
        "ترخيص HummyTummy",
        "الترخيص السنوي المطلوب لشراء واستخدام أي وحدة مدفوعة. يصبح تاريخ الشراء ذكرى حسابك السنوية.",
      ],
      [
        "HummyTummy litsenziyasi",
        "Har qanday pullik modulni sotib olish va ishlatish uchun zarur yillik litsenziya. Sotib olingan sana hisobingiz yillik sanasi bo'ladi.",
      ],
    ),
  },

  // ---------------------------------------------------------------- MODULES
  {
    code: "advanced_reports",
    name: "Gelişmiş Rapor & Analitik",
    description:
      "Detaylı satış, ürün, personel ve müşteri analitiği; muhasebe back-office ve e-belge ayarları.",
    kind: "module",
    billing: "annual",
    priceCents: 129_000,
    grants: { "feature.advancedReports": true },
    deps: [],
    requiresLicense: true,
    sortOrder: 10,
    i18n: t(
      [
        "Gelişmiş Rapor & Analitik",
        "Detaylı satış, ürün, personel ve müşteri analitiği ile muhasebe back-office.",
      ],
      [
        "Advanced Reports & Analytics",
        "Detailed sales, product, staff and customer analytics plus the accounting back-office.",
      ],
      [
        "Расширенные отчёты и аналитика",
        "Подробная аналитика продаж, товаров, персонала и клиентов, а также бухгалтерский бэк-офис.",
      ],
      [
        "التقارير والتحليلات المتقدمة",
        "تحليلات مفصلة للمبيعات والمنتجات والموظفين والعملاء بالإضافة إلى مكتب المحاسبة الخلفي.",
      ],
      [
        "Kengaytirilgan hisobot va tahlil",
        "Savdo, mahsulot, xodimlar va mijozlar bo'yicha batafsil tahlil hamda buxgalteriya back-office.",
      ],
    ),
  },
  {
    code: "module_inventory",
    name: "Stok & Maliyet Yönetimi",
    description:
      "Reçete, stok sayımı, satın alma siparişi, fire takibi, tedarikçi yönetimi ve şubeler arası transfer.",
    kind: "module",
    billing: "annual",
    priceCents: 149_000,
    grants: { "feature.inventoryTracking": true },
    deps: [],
    requiresLicense: true,
    sortOrder: 11,
    i18n: t(
      [
        "Stok & Maliyet Yönetimi",
        "Reçete, sayım, satın alma siparişi, fire takibi, tedarikçi ve şubeler arası transfer.",
      ],
      [
        "Inventory & Cost Management",
        "Recipes, stock counts, purchase orders, waste tracking, suppliers and inter-branch transfers.",
      ],
      [
        "Управление запасами и себестоимостью",
        "Рецепты, инвентаризация, заказы поставщикам, учёт списаний, поставщики и переводы между филиалами.",
      ],
      [
        "إدارة المخزون والتكاليف",
        "الوصفات وجرد المخزون وأوامر الشراء وتتبع الهدر والموردين والتحويلات بين الفروع.",
      ],
      [
        "Ombor va tannarx boshqaruvi",
        "Retseptlar, inventarizatsiya, xarid buyurtmalari, chiqindi hisobi, ta'minotchilar va filiallararo transfer.",
      ],
    ),
  },
  {
    code: "module_reservations",
    name: "Rezervasyon Sistemi",
    description:
      "Rezervasyon takvimi, müsaitlik hesabı, halka açık online rezervasyon sayfası ve personel rezervasyon girişi.",
    kind: "module",
    billing: "annual",
    priceCents: 99_000,
    grants: { "feature.reservationSystem": true },
    deps: [],
    requiresLicense: true,
    sortOrder: 12,
    i18n: t(
      [
        "Rezervasyon Sistemi",
        "Rezervasyon takvimi, müsaitlik hesabı ve halka açık online rezervasyon sayfası.",
      ],
      [
        "Reservation System",
        "Booking calendar, availability engine and a public online reservation page.",
      ],
      [
        "Система бронирования",
        "Календарь броней, расчёт доступности и публичная страница онлайн-бронирования.",
      ],
      [
        "نظام الحجوزات",
        "تقويم الحجوزات ومحرك التوافر وصفحة حجز إلكترونية عامة.",
      ],
      [
        "Rezervatsiya tizimi",
        "Bron kalendari, bandlik hisobi va ommaviy onlayn rezervatsiya sahifasi.",
      ],
    ),
  },
  {
    code: "module_personnel",
    name: "Personel Yönetimi",
    description:
      "Puantaj, vardiya planlama, vardiya değişimi ve personel performans takibi.",
    kind: "module",
    billing: "annual",
    priceCents: 99_000,
    grants: { "feature.personnelManagement": true },
    deps: [],
    requiresLicense: true,
    sortOrder: 13,
    i18n: t(
      [
        "Personel Yönetimi",
        "Puantaj, vardiya planlama, vardiya değişimi ve performans takibi.",
      ],
      [
        "Staff Management",
        "Attendance, shift planning, shift swaps and performance tracking.",
      ],
      [
        "Управление персоналом",
        "Табель учёта, планирование смен, обмен сменами и отслеживание эффективности.",
      ],
      [
        "إدارة الموظفين",
        "الحضور وتخطيط الورديات وتبادل الورديات وتتبع الأداء.",
      ],
      [
        "Xodimlarni boshqarish",
        "Davomat, smena rejalashtirish, smena almashinuvi va samaradorlik nazorati.",
      ],
    ),
  },
  {
    code: "module_ai_studio",
    name: "AI Menü Stüdyosu",
    description:
      "Yapay zekâ ile ürün fotoğrafı, video ve 3D model üretimi, menü OCR içe aktarma. Üretimler kontörle harcanır.",
    kind: "module",
    billing: "annual",
    priceCents: 199_000,
    grants: { "feature.aiContentGeneration": true },
    deps: [],
    requiresLicense: true,
    sortOrder: 14,
    i18n: t(
      [
        "AI Menü Stüdyosu",
        "Yapay zekâ ile ürün fotoğrafı, video ve 3D model üretimi ile menü OCR içe aktarma. Üretimler kontörle harcanır.",
      ],
      [
        "AI Menu Studio",
        "AI-generated product photos, video and 3D models, plus OCR menu import. Generations are paid for with credits.",
      ],
      [
        "AI-студия меню",
        "Генерация фото, видео и 3D-моделей товаров с помощью ИИ и импорт меню через OCR. Генерации расходуют кредиты.",
      ],
      [
        "استوديو القائمة بالذكاء الاصطناعي",
        "إنشاء صور ومقاطع فيديو ونماذج ثلاثية الأبعاد للمنتجات بالذكاء الاصطناعي واستيراد القائمة عبر OCR. تُخصم عمليات الإنشاء من الرصيد.",
      ],
      [
        "AI menyu studiyasi",
        "Sun'iy intellekt bilan mahsulot fotosurati, video va 3D model yaratish hamda OCR orqali menyu import qilish. Yaratishlar kredit hisobidan yechiladi.",
      ],
    ),
  },
  {
    code: "api_access",
    name: "API & Webhook Erişimi",
    description:
      "Kendi sistemlerinizi bağlamak için REST API anahtarları ve giden webhook'lar.",
    kind: "module",
    billing: "annual",
    priceCents: 249_000,
    grants: { "feature.apiAccess": true },
    deps: [],
    requiresLicense: true,
    sortOrder: 15,
    i18n: t(
      [
        "API & Webhook Erişimi",
        "Kendi sistemlerinizi bağlamak için REST API anahtarları ve giden webhook'lar.",
      ],
      [
        "API & Webhook Access",
        "REST API keys and outbound webhooks for connecting your own systems.",
      ],
      [
        "Доступ к API и вебхукам",
        "Ключи REST API и исходящие вебхуки для подключения ваших систем.",
      ],
      [
        "الوصول إلى API والويب هوك",
        "مفاتيح REST API وخطافات الويب الصادرة لربط أنظمتك الخاصة.",
      ],
      [
        "API va Webhook kirishi",
        "O'z tizimlaringizni ulash uchun REST API kalitlari va chiquvchi webhook'lar.",
      ],
    ),
  },
  {
    code: "module_external_display",
    name: "Partner Ekran API",
    description:
      "Üçüncü taraf ekranların (masa tabletleri, harici menü ekranları) menünüzü göstermesi için ekran bazlı API erişimi.",
    kind: "module",
    billing: "annual",
    priceCents: 199_000,
    grants: { "feature.externalDisplay": true },
    deps: [],
    requiresLicense: true,
    sortOrder: 16,
    i18n: t(
      [
        "Partner Ekran API",
        "Üçüncü taraf ekranların menünüzü göstermesi için ekran bazlı API erişimi.",
      ],
      [
        "Partner Display API",
        "Per-screen API access so third-party displays can show your menu.",
      ],
      [
        "API партнёрских экранов",
        "Доступ к API на уровне экрана, чтобы сторонние дисплеи показывали ваше меню.",
      ],
      [
        "واجهة برمجة شاشات الشركاء",
        "وصول برمجي لكل شاشة حتى تتمكن الشاشات الخارجية من عرض قائمتك.",
      ],
      [
        "Hamkor ekran API",
        "Uchinchi tomon ekranlari menyungizni ko'rsatishi uchun ekran darajasidagi API kirishi.",
      ],
    ),
  },
  {
    code: "priority_support",
    name: "Öncelikli Destek",
    description:
      "Destek taleplerinizde öncelikli sıra ve garantili yanıt süresi.",
    kind: "module",
    billing: "annual",
    priceCents: 199_000,
    grants: { "feature.prioritySupport": true },
    deps: [],
    requiresLicense: true,
    sortOrder: 17,
    i18n: t(
      [
        "Öncelikli Destek",
        "Destek taleplerinizde öncelikli sıra ve garantili yanıt süresi.",
      ],
      [
        "Priority Support",
        "Front-of-queue support with a guaranteed response time.",
      ],
      [
        "Приоритетная поддержка",
        "Приоритетная очередь обращений и гарантированное время ответа.",
      ],
      ["الدعم ذو الأولوية", "أولوية في طابور الدعم مع زمن استجابة مضمون."],
      [
        "Ustuvor qo'llab-quvvatlash",
        "Murojaatlarda ustuvor navbat va kafolatlangan javob vaqti.",
      ],
    ),
  },

  // ----------------------------------------------------------- INTEGRATIONS
  ...(
    [
      ["delivery_yemeksepeti", "Yemeksepeti", "yemeksepeti", 20],
      ["delivery_getir", "Getir", "getir", 21],
      ["delivery_trendyol_yemek", "Trendyol Yemek", "trendyol_yemek", 22],
    ] as const
  ).map(
    ([code, label, vendor, sortOrder]): AlaCarteProduct => ({
      code,
      name: `${label} Entegrasyonu`,
      description: `${label} siparişlerinin otomatik olarak POS ve mutfağa düşmesi.`,
      kind: "integration",
      billing: "annual",
      priceCents: 249_000,
      // The domain flag rides along with the vendor grant: owning ANY delivery
      // platform must light up the delivery UI, and `feature.*` folds with OR
      // so buying a second platform is idempotent.
      grants: {
        "integration.delivery": [vendor],
        "feature.deliveryIntegration": true,
      },
      deps: [],
      requiresLicense: true,
      sortOrder,
      i18n: t(
        [
          `${label} Entegrasyonu`,
          `${label} siparişleri otomatik olarak POS ve mutfağa düşer.`,
        ],
        [
          `${label} Integration`,
          `${label} orders flow automatically into the POS and the kitchen.`,
        ],
        [
          `Интеграция ${label}`,
          `Заказы ${label} автоматически поступают в POS и на кухню.`,
        ],
        [
          `تكامل ${label}`,
          `تصل طلبات ${label} تلقائيًا إلى نقطة البيع والمطبخ.`,
        ],
        [
          `${label} integratsiyasi`,
          `${label} buyurtmalari avtomatik ravishda POS va oshxonaga tushadi.`,
        ],
      ),
    }),
  ),
  {
    code: "fiscal_efatura",
    name: "e-Fatura (Nilvera)",
    description:
      "Satış faturalarınızın Nilvera üzerinden e-Fatura / e-Arşiv olarak GİB'e gönderilmesi.",
    kind: "integration",
    billing: "annual",
    priceCents: 199_000,
    grants: { "integration.fiscal": ["efatura"] },
    deps: [],
    requiresLicense: true,
    sortOrder: 23,
    i18n: t(
      [
        "e-Fatura (Nilvera)",
        "Satış faturalarınız Nilvera üzerinden e-Fatura / e-Arşiv olarak gönderilir.",
      ],
      [
        "e-Invoice (Nilvera)",
        "Your sales invoices are filed as e-Fatura / e-Arşiv through Nilvera.",
      ],
      [
        "Электронный счёт (Nilvera)",
        "Ваши счета отправляются как e-Fatura / e-Arşiv через Nilvera.",
      ],
      [
        "الفاتورة الإلكترونية (Nilvera)",
        "تُرسل فواتير مبيعاتك كفاتورة إلكترونية عبر Nilvera.",
      ],
      [
        "e-Faktura (Nilvera)",
        "Savdo hisob-fakturalaringiz Nilvera orqali e-Faktura sifatida yuboriladi.",
      ],
    ),
  },
  {
    code: "fiscal_hugin",
    name: "ÖKC / Yazarkasa (Hugin)",
    description:
      "Hugin yazarkasa ile entegre fiş kesimi ve mali rapor senkronizasyonu.",
    kind: "integration",
    billing: "annual",
    priceCents: 299_000,
    grants: { "integration.fiscal": ["hugin"] },
    // The pre-3.3 catalog gated this on `plan:PRO`. Plans are retired, so the
    // dep is cleared — leaving it would 400 every purchase the moment
    // Tenant.currentPlanId goes null.
    deps: [],
    requiresLicense: true,
    sortOrder: 24,
    i18n: t(
      [
        "ÖKC / Yazarkasa (Hugin)",
        "Hugin yazarkasa ile entegre fiş kesimi ve mali rapor senkronizasyonu.",
      ],
      [
        "Fiscal Printer (Hugin)",
        "Integrated receipt printing and fiscal report sync with a Hugin device.",
      ],
      [
        "Фискальный регистратор (Hugin)",
        "Интегрированная печать чеков и синхронизация фискальных отчётов с Hugin.",
      ],
      [
        "الطابعة الضريبية (Hugin)",
        "طباعة إيصالات متكاملة ومزامنة التقارير الضريبية مع جهاز Hugin.",
      ],
      [
        "Fiskal printer (Hugin)",
        "Hugin qurilmasi bilan integratsiyalashgan chek chiqarish va fiskal hisobot sinxronizatsiyasi.",
      ],
    ),
  },
  {
    code: "caller_id_integration",
    name: "Çağrı-ID Entegrasyonu",
    description:
      "Gelen telefon çağrılarında müşteriyi otomatik tanıma ve tek tıkla sipariş açma.",
    kind: "integration",
    billing: "annual",
    priceCents: 149_000,
    grants: { "integration.caller": ["generic"] },
    deps: [],
    requiresLicense: true,
    sortOrder: 25,
    i18n: t(
      [
        "Çağrı-ID Entegrasyonu",
        "Gelen çağrılarda müşteriyi otomatik tanıyın, tek tıkla sipariş açın.",
      ],
      [
        "Caller-ID Integration",
        "Recognise the customer on an incoming call and open an order in one click.",
      ],
      [
        "Интеграция Caller-ID",
        "Автоматическое распознавание клиента при входящем звонке и заказ в один клик.",
      ],
      [
        "تكامل معرّف المتصل",
        "التعرف تلقائيًا على العميل عند المكالمة الواردة وفتح طلب بنقرة واحدة.",
      ],
      [
        "Caller-ID integratsiyasi",
        "Kiruvchi qo'ng'iroqda mijozni avtomatik aniqlang va bir bosishda buyurtma oching.",
      ],
    ),
  },
  {
    code: "sms_integration",
    name: "SMS Bildirimleri",
    description:
      "Sipariş, rezervasyon ve kampanya SMS'leri. Gönderimler kontörle harcanır.",
    kind: "integration",
    billing: "annual",
    priceCents: 99_000,
    grants: { "integration.sms": ["*"] },
    deps: [],
    requiresLicense: true,
    sortOrder: 26,
    i18n: t(
      [
        "SMS Bildirimleri",
        "Sipariş, rezervasyon ve kampanya SMS'leri. Gönderimler kontörle harcanır.",
      ],
      [
        "SMS Notifications",
        "Order, reservation and campaign SMS. Each send is paid for with credits.",
      ],
      [
        "SMS-уведомления",
        "SMS о заказах, бронях и акциях. Каждая отправка расходует кредиты.",
      ],
      [
        "إشعارات الرسائل القصيرة",
        "رسائل الطلبات والحجوزات والحملات. تُخصم كل رسالة من الرصيد.",
      ],
      [
        "SMS bildirishnomalari",
        "Buyurtma, rezervatsiya va kampaniya SMS'lari. Har bir yuborish kredit hisobidan yechiladi.",
      ],
    ),
  },

  // -------------------------------------------------------------- CAPACITY
  {
    code: "extra_branch",
    name: "Ek Şube",
    description:
      "Hesabınıza bir şube daha ekler. İlk şube ücretsizdir. Adet olarak alınabilir.",
    kind: "capacity",
    billing: "annual",
    priceCents: 399_000,
    grants: { "limit.maxBranches": 1, "feature.multiLocation": true },
    deps: [],
    requiresLicense: true,
    maxQuantity: 100,
    sortOrder: 30,
    i18n: t(
      ["Ek Şube", "Hesabınıza bir şube daha ekler. İlk şube ücretsizdir."],
      [
        "Extra Branch",
        "Adds one more branch to your account. The first branch is free.",
      ],
      [
        "Дополнительный филиал",
        "Добавляет ещё один филиал. Первый филиал бесплатный.",
      ],
      ["فرع إضافي", "يضيف فرعًا آخر إلى حسابك. الفرع الأول مجاني."],
      [
        "Qo'shimcha filial",
        "Hisobingizga yana bitta filial qo'shadi. Birinchi filial bepul.",
      ],
    ),
  },

  // --------------------------------------------------------------- CREDITS
  {
    code: "credit_ai_photo_100",
    name: "100 AI Görsel Kontörü",
    description:
      "100 adet yapay zekâ ürün görseli üretim hakkı. Süresi yoktur, tükenene kadar geçerlidir.",
    kind: "credit",
    billing: "oneTime",
    priceCents: 69_000,
    grants: {},
    deps: ["module_ai_studio"],
    requiresLicense: false,
    creditKind: "PHOTO",
    creditUnits: 100,
    sortOrder: 40,
    i18n: t(
      [
        "100 AI Görsel Kontörü",
        "100 adet yapay zekâ görsel üretimi. Süresiz — tükenene kadar geçerli.",
      ],
      [
        "100 AI Image Credits",
        "100 AI image generations. No expiry — valid until consumed.",
      ],
      [
        "100 кредитов AI-изображений",
        "100 генераций изображений ИИ. Без срока — действуют до израсходования.",
      ],
      [
        "100 رصيد صور بالذكاء الاصطناعي",
        "100 عملية إنشاء صورة. بلا انتهاء صلاحية — صالحة حتى النفاد.",
      ],
      [
        "100 ta AI rasm krediti",
        "100 ta AI rasm yaratish. Muddatsiz — tugaguncha amal qiladi.",
      ],
    ),
  },
  {
    code: "credit_ai_video_20",
    name: "20 AI Video Kontörü",
    description:
      "20 adet yapay zekâ ürün videosu üretim hakkı. Süresi yoktur, tükenene kadar geçerlidir.",
    kind: "credit",
    billing: "oneTime",
    priceCents: 89_000,
    grants: {},
    deps: ["module_ai_studio"],
    requiresLicense: false,
    creditKind: "VIDEO",
    creditUnits: 20,
    sortOrder: 41,
    i18n: t(
      [
        "20 AI Video Kontörü",
        "20 adet yapay zekâ video üretimi. Süresiz — tükenene kadar geçerli.",
      ],
      [
        "20 AI Video Credits",
        "20 AI video generations. No expiry — valid until consumed.",
      ],
      [
        "20 кредитов AI-видео",
        "20 генераций видео ИИ. Без срока — действуют до израсходования.",
      ],
      [
        "20 رصيد فيديو بالذكاء الاصطناعي",
        "20 عملية إنشاء فيديو. بلا انتهاء صلاحية — صالحة حتى النفاد.",
      ],
      [
        "20 ta AI video krediti",
        "20 ta AI video yaratish. Muddatsiz — tugaguncha amal qiladi.",
      ],
    ),
  },
  {
    code: "credit_ai_3d_10",
    name: "10 AI 3D Model Kontörü",
    description:
      "10 adet yapay zekâ 3D ürün modeli üretim hakkı. Süresi yoktur, tükenene kadar geçerlidir.",
    kind: "credit",
    billing: "oneTime",
    priceCents: 79_000,
    grants: {},
    deps: ["module_ai_studio"],
    requiresLicense: false,
    creditKind: "MODEL3D",
    creditUnits: 10,
    sortOrder: 42,
    i18n: t(
      [
        "10 AI 3D Model Kontörü",
        "10 adet yapay zekâ 3D model üretimi. Süresiz — tükenene kadar geçerli.",
      ],
      [
        "10 AI 3D Model Credits",
        "10 AI 3D model generations. No expiry — valid until consumed.",
      ],
      [
        "10 кредитов AI 3D-моделей",
        "10 генераций 3D-моделей ИИ. Без срока — действуют до израсходования.",
      ],
      [
        "10 رصيد نموذج ثلاثي الأبعاد",
        "10 عمليات إنشاء نموذج ثلاثي الأبعاد. بلا انتهاء صلاحية — صالحة حتى النفاد.",
      ],
      [
        "10 ta AI 3D model krediti",
        "10 ta AI 3D model yaratish. Muddatsiz — tugaguncha amal qiladi.",
      ],
    ),
  },
  {
    code: "credit_sms_500",
    name: "500 SMS Kontörü",
    description:
      "500 adet SMS gönderim hakkı. Süresi yoktur, tükenene kadar geçerlidir.",
    kind: "credit",
    billing: "oneTime",
    priceCents: 49_000,
    grants: {},
    deps: ["sms_integration"],
    requiresLicense: false,
    creditKind: "SMS",
    creditUnits: 500,
    sortOrder: 43,
    i18n: t(
      [
        "500 SMS Kontörü",
        "500 adet SMS gönderimi. Süresiz — tükenene kadar geçerli.",
      ],
      ["500 SMS Credits", "500 SMS sends. No expiry — valid until consumed."],
      [
        "500 SMS-кредитов",
        "500 отправок SMS. Без срока — действуют до израсходования.",
      ],
      [
        "500 رصيد رسائل قصيرة",
        "500 عملية إرسال رسالة. بلا انتهاء صلاحية — صالحة حتى النفاد.",
      ],
      [
        "500 ta SMS krediti",
        "500 ta SMS yuborish. Muddatsiz — tugaguncha amal qiladi.",
      ],
    ),
  },

  // --------------------------------------------------------------- SERVICE
  {
    code: "onsite_install_full",
    name: "Yerinde Kurulum & Eğitim",
    description:
      "Tam gün yerinde kurulum, cihaz devreye alma ve personel eğitimi. Tek seferlik hizmet.",
    kind: "service",
    billing: "oneTime",
    priceCents: 750_000,
    grants: {},
    deps: [],
    requiresLicense: false,
    sortOrder: 50,
    i18n: t(
      [
        "Yerinde Kurulum & Eğitim",
        "Tam gün yerinde kurulum, cihaz devreye alma ve personel eğitimi.",
      ],
      [
        "On-site Installation & Training",
        "A full day of on-site installation, device commissioning and staff training.",
      ],
      [
        "Установка и обучение на месте",
        "Полный день установки на месте, ввода устройств в эксплуатацию и обучения персонала.",
      ],
      [
        "التركيب والتدريب في الموقع",
        "يوم كامل من التركيب في الموقع وتشغيل الأجهزة وتدريب الموظفين.",
      ],
      [
        "Joyida o'rnatish va o'qitish",
        "To'liq kunlik joyida o'rnatish, qurilmalarni ishga tushirish va xodimlarni o'qitish.",
      ],
    ),
  },
];

/**
 * Products retired by the à-la-carte model. ARCHIVED, never deleted:
 * `MarketplaceAddOn.code` may not be reused and `TenantAddOn.addOnId` is
 * onDelete: Restrict, so a delete would either orphan or fail.
 *
 * All three granted `limit.kdsScreens` / `limit.kdsStations` / `limit.tablets`
 * — keys no enforcement code has ever read. They were sold and enforced
 * nothing; à-la-carte drops device capacity pricing entirely.
 */
export const RETIRED_ADDON_CODES = [
  "kds_extra_screen",
  "kds_extra_station",
  "extra_tablet",
] as const;

export const ALACARTE_CATALOG_BY_CODE: ReadonlyMap<string, AlaCarteProduct> =
  new Map(ALACARTE_CATALOG.map((p) => [p.code, p]));
