# Hardware-Store Product Images

This directory serves product photos for the landing page storefront
(`/[locale]/store`) and the SPA admin store (`/app/admin/store`).
Next.js serves `landing/public/*` at the site root, so a file placed at
`landing/public/products/<sku>.webp` becomes available as
`https://hummytummy.com/products/<sku>.webp` (and the staging equivalent).

## Naming

One file per SKU. The seed
(`backend/prisma/seeds/seed-marketplace.ts`) hard-codes the expected
path as `/products/<sku>.webp` for every product. Drop a file with the
exact same SKU as filename — it shows up on the next page load.

If the file is missing the store cards silently hide the `<img>` (an
`onError` handler on the renderer drops it) so half-stocked image
state still looks clean.

## Format + sizing

- **Format:** WebP (smaller, modern browser support). Already widely
  used elsewhere in the landing assets.
- **Max dimensions:** 1000×1000. The cards crop to a 4:3 ratio with
  `object-cover`, so taller/wider source images get cropped automatically
  to a uniform card height.
- **Target size:** under 100 KB. Quality 80-85 with `cwebp` or PIL's
  WebP encoder lands here for product shots.
- **Background:** white or transparent. Avoid noisy backgrounds —
  the storefront cards already have their own background.

## Quick convert (PIL)

```python
from PIL import Image
img = Image.open('source.jpg').convert('RGB')
img.thumbnail((1000, 1000), Image.LANCZOS)
img.save('landing/public/products/<sku>.webp', format='WEBP', quality=82, method=6)
```

## Quick convert (cwebp)

```bash
cwebp -q 82 source.jpg -resize 1000 0 -o landing/public/products/<sku>.webp
```

## Current state (2026-05-26)

Real product photos shipped:
- `yazarkasa-hugin-tiger-t300.webp`
- `yazarkasa-beko-300tr.webp`
- `printer-epson-tm-t20iii-lan.webp`
- `scanner-zebra-ds2208.webp`

The other 11 SKUs reference paths in the seed but the files haven't
been added yet. The cards render brand+model+price as text fallback
(no broken image icon). Drop the WebP files in here when ready —
they take effect on the next CDN cache flush / page load.
