export type GuideCategory =
  | "MEAT"
  | "PRODUCE"
  | "DRY_GOODS"
  | "DAIRY"
  | "BEVERAGE"
  | "PACKAGING"
  | "CLEANING";

// Turkish-aware fold: lowercase with İ/I handling, strip diacritics for matching.
const fold = (s: string): string =>
  s
    .replace(/İ/g, "i")
    .replace(/I/g, "i")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .trim();

// Keyword lists are conservative; extend with the research report in Phase 3.
const KEYWORDS: Record<GuideCategory, string[]> = {
  MEAT: [
    "kiyma",
    "dana",
    "kuzu",
    "et",
    "tavuk",
    "but",
    "kanat",
    "gogus",
    "antrikot",
    "biftek",
    "sucuk",
    "sosis",
    "pastirma",
    "balik",
    "somon",
    "levrek",
    "cipura",
    "hamsi",
  ],
  PRODUCE: [
    "domates",
    "salatalik",
    "biber",
    "sogan",
    "sarimsak",
    "patates",
    "marul",
    "maydanoz",
    "limon",
    "elma",
    "muz",
    "portakal",
    "yesillik",
    "sebze",
    "meyve",
    "patlican",
    "kabak",
    "havuc",
  ],
  DRY_GOODS: [
    "pirinc",
    "bulgur",
    "mercimek",
    "nohut",
    "fasulye",
    "makarna",
    "un",
    "seker",
    "tuz",
    "salca",
    "yag",
    "zeytinyagi",
    "baharat",
    "bakliyat",
    "kuru",
  ],
  DAIRY: [
    "sut",
    "peynir",
    "yogurt",
    "kaymak",
    "tereyag",
    "krema",
    "ayran",
    "yumurta",
    "kasar",
    "labne",
  ],
  BEVERAGE: [
    "kola",
    "gazoz",
    "su",
    "maden",
    "meyve suyu",
    "cay",
    "kahve",
    "icecek",
    "soda",
    "ayran",
    "nektar",
  ],
  PACKAGING: [
    "karton",
    "kutu",
    "ambalaj",
    "poset",
    "strec",
    "folyo",
    "bardak",
    "tabak",
    "catal",
    "kasik",
    "pipet",
    "servis",
    "kese",
  ],
  CLEANING: [
    "temizlik",
    "deterjan",
    "sabun",
    "bez",
    "eldiven",
    "cop",
    "hijyen",
    "dezenfekt",
    "kagit havlu",
    "tuvalet",
    "bulasik",
  ],
};

const ORDER: GuideCategory[] = [
  "MEAT",
  "PRODUCE",
  "DRY_GOODS",
  "DAIRY",
  "BEVERAGE",
  "PACKAGING",
  "CLEANING",
];

// Flatten to (keyword, category) pairs, longest keyword first so a specific
// term (tereyag, "meyve suyu") beats a shorter substring of it (yag, meyve)
// from another category; equal-length ties break by category ORDER.
// Substring-within-token matching (see scan() below) is required for
// keywords >=4 chars because Turkish suffixes attach to the stem (tereyagi,
// sucuklu) — longest-first resolves the collisions. Keywords <=3 chars are
// word-boundary (whole-token) only; see scan().
const RANKED: Array<{ kw: string; cat: GuideCategory }> = ORDER.flatMap((cat) =>
  KEYWORDS[cat].map((kw) => ({ kw, cat })),
).sort(
  (a, b) =>
    b.kw.length - a.kw.length || ORDER.indexOf(a.cat) - ORDER.indexOf(b.cat),
);

// Short keywords (<=3 chars, e.g. "et", "su", "un") are only matched as a
// WHOLE token: raw substring matching lets them fire inside unrelated words
// ("Peçete" -> "pecete" contains "et"; "Sünger" -> "sunger" contains "un"),
// mislabeling universal items like napkins as MEAT. Longer keywords (>=4
// chars) keep substring-within-token matching, since Turkish suffixes attach
// directly to the stem with no separator (tereyagi, sucuklu, kiymali).
// Keywords with an embedded space (multi-word, e.g. "meyve suyu") are matched
// as a raw substring against the whole folded string, since tokenizing would
// split them apart.
const tokenize = (f: string): string[] => f.match(/[a-z]+/g) ?? [];

const scan = (text: string): GuideCategory | null => {
  const f = fold(text);
  const tokens = tokenize(f);
  for (const { kw, cat } of RANKED) {
    if (kw.includes(" ")) {
      if (f.includes(kw)) return cat;
    } else if (kw.length <= 3) {
      if (tokens.includes(kw)) return cat;
    } else if (tokens.some((t) => t.includes(kw))) {
      return cat;
    }
  }
  return null;
};

export const matchCategory = (input: {
  categoryName?: string | null;
  itemName: string;
}): GuideCategory | null =>
  (input.categoryName ? scan(input.categoryName) : null) ??
  scan(input.itemName);
