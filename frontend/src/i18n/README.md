# i18n (Internationalization) Setup Guide

Bu rehber, Restaurant POS uygulamasında çok dilli (İngilizce ve Türkçe) desteğinin nasıl kullanılacağını açıklar.

## 📁 Dosya Yapısı

```
src/i18n/
├── config.ts                 # i18next yapılandırması
├── locales/
│   ├── en/                   # İngilizce çeviriler
│   │   ├── common.json       # Ortak UI metinleri
│   │   ├── auth.json         # Giriş/Kayıt sayfaları
│   │   ├── pos.json          # POS sistemi
│   │   ├── kitchen.json      # Mutfak Ekranı
│   │   ├── menu.json         # Menü yönetimi
│   │   ├── orders.json       # Siparişler
│   │   ├── customers.json    # Müşteriler
│   │   ├── settings.json     # Ayarlar
│   │   ├── subscriptions.json# Abonelikler
│   │   ├── reports.json      # Raporlar
│   │   ├── validation.json   # Form doğrulama
│   │   └── errors.json       # Hata mesajları
│   └── tr/                   # Türkçe çeviriler (aynı yapı)
└── index.ts                  # i18n başlatması
```

## 🚀 Kullanım

### 1. Bileşenlerde Çeviriler Kullanma

```typescript
import { useTranslation } from 'react-i18next';

const MyComponent = () => {
  const { t } = useTranslation('common'); // namespace belirt
  
  return (
    <div>
      <h1>{t('app.name')}</h1>
      <button>{t('buttons.save')}</button>
    </div>
  );
};
```

### 2. Birden Fazla Namespace Kullanma

```typescript
const { t } = useTranslation(['common', 'auth', 'validation']);

// Kullanım
<p>{t('common:app.loading')}</p>
<p>{t('auth:login.title')}</p>
<p>{t('validation:required')}</p>
```

### 3. Dinamik Değerler (Interpolation)

```typescript
// JSON dosyasında:
// "minLength": "Must be at least {{count}} characters"

// Bileşende:
const { t } = useTranslation('validation');
<p>{t('minLength', { count: 8 })}</p>
// Çıktı: "Must be at least 8 characters"
```

### 4. Çoğullaştırma (Pluralization)

```typescript
// JSON dosyasında:
// "itemCount_one": "You have 1 item",
// "itemCount_other": "You have {{count}} items"

// Bileşende:
<p>{t('itemCount', { count: 5 })}</p>
// Çıktı: "You have 5 items"
```

### 5. Dil Değiştirme

```typescript
import { useTranslation } from 'react-i18next';

const LanguageSwitcher = () => {
  const { i18n } = useTranslation();
  
  const changeLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('i18n_language', lang);
    document.documentElement.lang = lang;
  };
  
  return (
    <button onClick={() => changeLanguage('tr')}>
      Türkçe
    </button>
  );
};
```

## 📝 Yeni Çeviri Ekleme

### 1. Yeni Namespace Oluşturma

Örneğin, "reports" için yeni çeviriler eklemek istiyorsanız:

1. `src/i18n/locales/en/reports.json` oluşturun:
```json
{
  "reports": {
    "title": "Reports",
    "sales": "Sales Report",
    "revenue": "Revenue Report"
  }
}
```

2. `src/i18n/locales/tr/reports.json` oluşturun:
```json
{
  "reports": {
    "title": "Raporlar",
    "sales": "Satış Raporu",
    "revenue": "Gelir Raporu"
  }
}
```

3. `src/i18n/config.ts`'de namespace'i ekleyin:
```typescript
import enReports from './locales/en/reports.json';
import trReports from './locales/tr/reports.json';

const resources = {
  en: {
    // ... diğer namespaces
    reports: enReports,
  },
  tr: {
    // ... diğer namespaces
    reports: trReports,
  },
};

// ns array'ine ekleyin
ns: ['common', 'auth', 'pos', 'kitchen', 'menu', 'orders', 'customers', 'settings', 'subscriptions', 'reports', 'validation', 'errors'],
```

### 2. Mevcut Namespace'e Çeviri Ekleme

1. `src/i18n/locales/en/common.json`'a ekleyin:
```json
{
  "app": {
    "newKey": "New Value"
  }
}
```

2. `src/i18n/locales/tr/common.json`'a ekleyin:
```json
{
  "app": {
    "newKey": "Yeni Değer"
  }
}
```

## 🔧 Yapılandırma

`src/i18n/config.ts` dosyasında yapılandırma yapılır:

```typescript
i18next.init({
  resources,           // Çeviri dosyaları
  lng: getSavedLanguage(), // Varsayılan dil
  fallbackLng: 'en',   // Yedek dil
  defaultNS: 'common', // Varsayılan namespace
  ns: [...],           // Tüm namespaces
  interpolation: {
    escapeValue: false // React zaten escape ediyor
  },
  detection: {
    order: ['localStorage', 'navigator'],
    caches: ['localStorage'],
  },
});
```

## 💾 LocalStorage Kalıcılığı

Dil tercihi otomatik olarak localStorage'da kaydedilir:

```typescript
// Dil değiştirildiğinde
i18n.on('languageChanged', (lng) => {
  localStorage.setItem('i18n_language', lng);
  document.documentElement.lang = lng;
});
```

Uygulama yüklendiğinde:
1. localStorage'dan kaydedilmiş dili kontrol et
2. Bulunamazsa tarayıcı dilini algıla
3. Desteklenmiyorsa İngilizceye varsayılan olarak ayarla

## 🌍 Desteklenen Diller

- **en** - English (İngilizce)
- **tr** - Türkçe

## 📚 Kaynaklar

- [react-i18next Dokümantasyonu](https://react.i18next.com/)
- [i18next Dokümantasyonu](https://www.i18next.com/)

## ✅ Best Practices

1. **Namespace Organizasyonu**: Çevirileri özelliğe göre organize edin
2. **Tutarlı Anahtarlar**: Aynı metinler için aynı anahtarları kullanın
3. **Açıklayıcı Anahtarlar**: Anahtarlar metinin amacını açıkça belirtmelidir
4. **Tüm Dilleri Güncelle**: Yeni çeviri eklerken tüm dilleri güncelleyin
5. **Dinamik Değerler**: Interpolation kullanarak dinamik değerleri işleyin
6. **Erişilebilirlik**: HTML lang özniteliğini güncelleyin

## 🐛 Sorun Giderme

### Çeviri Gösterilmiyor

1. Namespace'in `config.ts`'de tanımlandığını kontrol edin
2. JSON dosyasının doğru yolda olduğunu kontrol edin
3. Anahtarın JSON dosyasında mevcut olduğunu kontrol edin
4. Tarayıcı konsolunda hata mesajlarını kontrol edin

### Dil Değişmiyor

1. localStorage'ı temizleyin
2. Tarayıcıyı yenileyin
3. `i18n.changeLanguage()` çağrısının doğru yapıldığını kontrol edin

### Eksik Çeviriler

`i18next` eksik çevirileri konsolda uyarı olarak gösterir. Tüm çevirileri tamamlayın.

