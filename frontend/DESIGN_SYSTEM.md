# Design System - Warm Modern Theme

Bu dokümantasyon, HummyTummy frontend uygulamasının Design System'ini açıklar.

## 🎨 Renk Paleti

### Primary Colors (Warm Orange)
Ana renk paleti sıcak turuncu tonlarından oluşur:

- **Primary 500**: `#f97316` - Ana primary renk
- **Primary 600**: `#ea580c` - Secondary renk (daha koyu)
- **Primary 400**: `#fb923c` - Daha açık ton
- **Primary 700**: `#c2410c` - Daha koyu ton

### Accent Colors (Green - Success)
Başarı durumları ve vurgular için:

- **Accent 500**: `#10b981` - Ana accent renk
- **Accent 600**: `#059669` - Daha koyu ton
- **Accent 400**: `#4ade80` - Daha açık ton

### Semantic Colors
Uygulama genelinde tutarlılık için:

- **Success**: `#10b981` - Başarılı işlemler
- **Warning**: `#f59e0b` - Uyarılar
- **Error**: `#ef4444` - Hatalar
- **Info**: `#3b82f6` - Bilgilendirmeler

### Neutral Colors
Metin ve arka planlar için:

- **Neutral 50**: `#fafaf9` - En açık arka plan
- **Neutral 500**: `#78716c` - Orta ton metin
- **Neutral 900**: `#1c1917` - En koyu metin

## 📝 Kullanım Örnekleri

### Tailwind CSS ile Kullanım

```tsx
// Primary renk kullanımı
<button className="bg-primary-500 text-primary-foreground hover:bg-primary-600">
  Primary Button
</button>

// Accent renk kullanımı
<div className="bg-accent-500 text-accent-foreground">
  Success Message
</div>

// Semantic renkler
<div className="bg-success text-white">Başarılı</div>
<div className="bg-error text-white">Hata</div>
<div className="bg-warning text-white">Uyarı</div>
<div className="bg-info text-white">Bilgi</div>
```

### CSS Variables ile Kullanım

```css
.custom-element {
  background-color: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  border: 1px solid hsl(var(--border));
}
```

## 📐 Typography

### Font Aileleri

- **Sans**: `Inter` - Varsayılan metin fontu
- **Heading**: `Outfit` - Başlıklar için
- **Mono**: `JetBrains Mono` - Kod blokları için

### Font Boyutları

```tsx
// Tailwind sınıfları
<p className="text-xs">12px - Extra Small</p>
<p className="text-sm">14px - Small</p>
<p className="text-base">16px - Base</p>
<p className="text-lg">18px - Large</p>
<p className="text-xl">20px - Extra Large</p>
<p className="text-2xl">24px - 2X Large</p>
<p className="text-3xl">30px - 3X Large</p>
```

### Font Ağırlıkları

- `font-light`: 300
- `font-normal`: 400
- `font-medium`: 500
- `font-semibold`: 600
- `font-bold`: 700
- `font-extrabold`: 800

## 📏 Spacing Sistemi

4px tabanlı spacing sistemi:

```tsx
// Padding & Margin örnekleri
<div className="p-4">16px padding</div>
<div className="m-6">24px margin</div>
<div className="gap-8">32px gap</div>
```

## 🔲 Border Radius

```tsx
<div className="rounded-sm">4px</div>
<div className="rounded-md">6px</div>
<div className="rounded-lg">8px</div>
<div className="rounded-xl">12px</div>
<div className="rounded-2xl">16px</div>
<div className="rounded-full">Tam yuvarlak</div>
```

## 🌑 Shadows

```tsx
<div className="shadow-sm">Küçük gölge</div>
<div className="shadow-md">Orta gölge</div>
<div className="shadow-lg">Büyük gölge</div>
<div className="shadow-xl">Çok büyük gölge</div>
<div className="shadow-2xl">En büyük gölge</div>
```

## 🎯 Design Tokens Kullanımı

TypeScript'te design tokens'ı kullanmak için:

```tsx
import { designTokens } from '@/lib/design-system';

// Renk kullanımı
const primaryColor = designTokens.colors.primary[500]; // '#f97316'

// Typography kullanımı
const fontSize = designTokens.typography.fontSize.lg;

// Spacing kullanımı
const padding = designTokens.spacing[4]; // '1rem'
```

## 📱 Responsive Breakpoints

- **sm**: 640px
- **md**: 768px
- **lg**: 1024px
- **xl**: 1280px
- **2xl**: 1536px

```tsx
<div className="text-sm md:text-base lg:text-lg">
  Responsive text
</div>
```

## 🎨 Component Örnekleri

### Button Variants

```tsx
// Primary button
<Button variant="primary">Primary</Button>

// Secondary button
<Button variant="secondary">Secondary</Button>

// Success button
<Button variant="success">Success</Button>

// Error button
<Button variant="danger">Error</Button>
```

### Card Component

```tsx
<Card>
  <CardHeader>
    <CardTitle>Başlık</CardTitle>
  </CardHeader>
  <CardContent>
    İçerik
  </CardContent>
</Card>
```

## 🔄 Migration Notları

Eski renklerden yeni renklere geçiş:

- Eski `primary-500` (#d4915e) → Yeni `primary-500` (#f97316)
- Eski `warm.orange` → Yeni `primary-500`
- Eski `bg-blue-600` → Yeni `bg-primary-500` veya `bg-info`
- Eski `bg-gray-900` → Yeni `bg-neutral-900`

## 📚 Daha Fazla Bilgi

Detaylı token listesi için: `src/lib/design-system.ts`
