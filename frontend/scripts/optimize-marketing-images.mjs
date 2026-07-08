// Generate optimized webp derivatives of the HummyTummy voxel brand images
// for the marketing landing pages. Source PNGs are ~1.4-2.2 MB each; this emits
// two widths of webp into public/marketing/ so pages stay light.
//
// Selection & keys follow the design spec (§2): images are mapped by their
// REAL content, not their (misleading) filenames. The two off-brand images
// (Kafe_Ortam_Kurulum = "TavernHero"/₹, Kahve_Barista_Latte = app-store poster)
// are intentionally excluded.
//
// Run from the frontend/ dir:  node scripts/optimize-marketing-images.mjs
import sharp from "sharp";
import { mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(root, "public");
const OUT = path.join(root, "public", "marketing");

// source filename (without .png)  ->  stable key used by src/marketing/data/images.ts
const MAP = {
  HummyTummy_Tatli_Menu_Cikolata: "heroTablet",
  HummyTummy_Musteri_Destek_Sef: "mascot",
  HummyTummy_Dijital_Menu_Yonetimi: "posTerminal",
  HummyTummy_Premium_Guvenlik_Kalkan: "qrStand",
  HummyTummy_Restoran_Ic_Mekan: "kdsChef",
  HummyTummy_Fatura_Odeme_Sistemi: "kdsCooking",
  HummyTummy_Rapor_Dokuman_Analiz: "posChef",
  HummyTummy_Sef_Tablet_Siparis: "mascotServe",
  HummyTummy_Menu_Yonetimi_Yemek: "deliveryScooter",
  HummyTummy_Gelir_Buyume_Grafik: "deliveryCity",
  HummyTummy_Satis_Analiz_Dashboard: "reportPhone",
  HummyTummy_Satis_Komisyon_Gelir: "chartIcon",
  HummyTummy_Veri_Guvenligi_SSL: "analytics",
  HummyTummy_Sef_Laptop_POS: "cloudNetwork",
  HummyTummy_Siparis_Takip_Tablet: "cloudServers",
  HummyTummy_Mutfak_Ekrani_KDS: "dioramaInterior",
  HummyTummy_QR_Menu_Mobil_Uygulama: "dioramaBuilding",
  HummyTummy_Hesap_Guvenlik_Kilit: "shield",
  HummyTummy_Hosgeldin_Sef_Karakter: "mascotShield",
  HummyTummy_Kar_Buyume_Para: "supportAgent",
};

const WIDTHS = { lg: 1000, sm: 520 };
const QUALITY = 78;

await mkdir(OUT, { recursive: true });

const dims = {}; // key -> { w, h } of the lg output
let missing = [];

for (const [srcBase, key] of Object.entries(MAP)) {
  const srcPath = path.join(SRC, `${srcBase}.png`);
  if (!existsSync(srcPath)) {
    missing.push(srcBase);
    continue;
  }
  for (const [label, width] of Object.entries(WIDTHS)) {
    const outPath = path.join(OUT, `${key}-${label}.webp`);
    const info = await sharp(srcPath)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: QUALITY, effort: 5 })
      .toFile(outPath);
    if (label === "lg") dims[key] = { w: info.width, h: info.height };
  }
  process.stdout.write(`✓ ${key}\n`);
}

if (missing.length) {
  console.error("\nMISSING SOURCES:", missing.join(", "));
  process.exit(1);
}

// Report the generated lg dimensions so images.ts can carry width/height (CLS).
console.log("\nDIMENSIONS_JSON=" + JSON.stringify(dims));

// Sanity: report output weight.
const files = await readdir(OUT);
console.log(`\nGenerated ${files.length} webp files in public/marketing/`);
