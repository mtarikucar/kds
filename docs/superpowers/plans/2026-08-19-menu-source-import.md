# Menüyü kaynaktan içe aktarma — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menü yönetimindeki tek "Toplu ekle" düğmesinin altına üç yol koymak — kaynak ver (link/dosya), fotoğraftan al, manuel — ve "kaynak ver" ile verilen HTML sayfası, PDF veya CSV/XLSX dosyasındaki bütün ürünleri mevcut incele→onayla hattına dökmek.

**Architecture:** Tek yeni uç `POST /menu/import/parse-source` baytları güvenle getirir (`assertPublicHttpUrl`), içerik tipini sihirli baytlardan tespit eder ve üç çıkarıcıdan birine yönlendirir. Üçü de mevcut `CommitMenuImportDto` şeklini üretir, `normaliseDraft()` ile temizlenir, çakışmalar işaretlenir ve bugünkü `POST /menu/import/commit` ucuna gider. Frontend'de inceleme ızgarası bileşene çıkarılıp üç kaynak tarafından paylaşılır.

**Tech Stack:** NestJS + Prisma + axios (backend), React + TanStack Query + Tailwind (frontend), Anthropic Messages API, jest (backend), vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-08-19-menu-source-import-design.md`

## Global Constraints

- Taslak sözleşmesi `CommitMenuImportDto` — hiçbir kaynak yeni bir şekil icat etmez.
- `normaliseDraft()` (`menu-import.service.ts:175`) her kaynağın tek normalizasyon adımıdır; kopyalanmaz.
- `POST /menu/import/commit` plan kapısına takılı **değildir** ve öyle kalır (BulkAddModal onu paylaşıyor).
- Kontör kovası `"PHOTO"` (`AiQuotaKind = "PHOTO" | "VIDEO" | "MODEL3D"`, `menu-ai-quota.service.ts:6`). Yeni kova eklenmez.
- Claude çağrısı: `ANTHROPIC_URL`, header `x-api-key` + `anthropic-version: 2023-06-01`, model `MENU_IMPORT_MODEL` (varsayılan `claude-sonnet-5`), timeout `120_000`.
- Dışa çıkan her istek `assertPublicHttpUrl` ile **iki fazlı** doğrulanır (kabulde + sokete bağlanmadan hemen önce).
- Fetch tavanları: timeout 15s, gövde 10MB, yönlendirme 3. Hepsi `numericEnv()` ile ayarlanabilir.
- Parçalama: parça ≤ 24.000 karakter, örtüşme 15 satır, en fazla 6 parça.
- Türkçe kullanıcıya görünen her metin `t()` ile ve 5 dile (`tr`, `en`, `ru`, `uz`, `ar`) eklenir — CI'daki locale parity kontrolü yoksa düşer.
- Backend testi: `cd backend && npx jest <path>`. Frontend testi: `cd frontend && npx vitest run <path>`.

---

## File Structure

**Backend — yeni**

| Dosya | Sorumluluk |
|---|---|
| `backend/src/modules/menu/services/menu-source-fetcher.service.ts` | Bir adresten baytları güvenle getirir. Ağ dışında hiçbir şey bilmez. |
| `backend/src/modules/menu/services/menu-source-sniff.ts` | Baytlar + başlık + dosya adı → `SourceKind`. Saf fonksiyon. |
| `backend/src/modules/menu/services/menu-text-chunker.ts` | Uzun metni örtüşmeli parçalara böler, taslakları birleştirir. Saf. |
| `backend/src/modules/menu/services/menu-tabular-mapper.ts` | Başlık satırı → sütun eşlemesi, satırlar → taslak. Saf. |
| `backend/src/modules/menu/services/menu-source.service.ts` | Yönlendirici: sniff → çıkarıcı → `normaliseDraft` → çakışma işaretleme. |

**Backend — değişen**

| Dosya | Değişiklik |
|---|---|
| `menu-import.service.ts` | `askClaude()` çıkarılır; `annotateConflicts()` eklenir; `commitDraft()` çakışma dalları kazanır. |
| `menu-import.dto.ts` | `onConflict` + `existingProductId` alanları. |
| `menu-import.controller.ts` | `POST parse-source`. |
| `menu.module.ts` | Dört yeni provider. |

**Frontend — yeni**

| Dosya | Sorumluluk |
|---|---|
| `frontend/src/pages/admin/menuManagement/useMenuDraft.ts` | Taslak durumu + değiştiriciler + doğrulama. Görselden bağımsız. |
| `frontend/src/pages/admin/menuManagement/MenuDraftReviewGrid.tsx` | Salt sunum ızgara. Kaynağı bilmez. |
| `frontend/src/pages/admin/menuManagement/MenuSourceTab.tsx` | Link/dosya girişi → ızgara. |

**Frontend — değişen**

| Dosya | Değişiklik |
|---|---|
| `MenuImportTab.tsx` | Izgara ve durum dışarı taşınır; `FeatureGate` yalnız parse adımını sarar. |
| `MenuManagementPage.tsx` | İki düğme → tek `DropdownMenu`, üç seçenek, tek modal. |
| `features/menu/menuApi.ts` | `useParseMenuSource`, çakışma tipleri. |

---

## Task 1: Claude taşımasını ortaklaştır

**Files:**
- Modify: `backend/src/modules/menu/services/menu-import.service.ts:118-160`
- Test: `backend/src/modules/menu/services/menu-import.service.spec.ts`

**Interfaces:**
- Consumes: yok (ilk görev)
- Produces: `private askClaude(blocks: unknown[], prompt: string): Promise<string>` — Claude'a içerik bloklarını + metin promptunu yollar, birleştirilmiş metin döner. HTTP hatasında `ServiceUnavailableException` fırlatır. **Kontör düşmez/iade etmez** — çağıran sorumludur.

- [ ] **Step 1: Write the failing test**

`menu-import.service.spec.ts` içine ekle:

```ts
  it("askClaude posts the given blocks and joins text parts", async () => {
    config.get.mockImplementation((k: string) =>
      k === "ANTHROPIC_API_KEY" ? "key1" : undefined,
    );
    (axios.post as jest.Mock).mockResolvedValue({
      data: { content: [{ type: "text", text: "a" }, { type: "other" }, { type: "text", text: "b" }] },
    });

    const out = await (svc as any).askClaude(
      [{ type: "text", text: "BLOCK" }],
      "PROMPT",
    );

    expect(out).toBe("a\nb");
    const [url, body, opts] = (axios.post as jest.Mock).mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "BLOCK" },
      { type: "text", text: "PROMPT" },
    ]);
    expect(opts.headers["anthropic-version"]).toBe("2023-06-01");
    expect(opts.timeout).toBe(120_000);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/modules/menu/services/menu-import.service.spec.ts -t "askClaude posts"`
Expected: FAIL — `svc.askClaude is not a function`

- [ ] **Step 3: Extract the method**

`menu-import.service.ts`'e ekle (sınıf içinde, `parseMenuPhotos`'un altına):

```ts
  /**
   * Single Claude transport for every menu source. Content blocks differ per
   * source (image / document / text); everything else — model, headers,
   * timeout, how the answer's text parts are joined — is identical, so it
   * lives here once.
   *
   * Deliberately does NOT touch the quota: the caller claims before and
   * refunds after, because only the caller knows how many units the whole
   * operation cost (a chunked import claims N up front).
   */
  private async askClaude(blocks: unknown[], prompt: string): Promise<string> {
    const apiKey = this.config.get<string>("ANTHROPIC_API_KEY");
    if (!apiKey) {
      throw new ServiceUnavailableException(
        "AI menu import is not configured (ANTHROPIC_API_KEY missing).",
      );
    }
    const model =
      this.config.get<string>("MENU_IMPORT_MODEL") || "claude-sonnet-5";
    try {
      const res = await axios.post(
        ANTHROPIC_URL,
        {
          model,
          max_tokens: 8000,
          messages: [
            { role: "user", content: [...blocks, { type: "text", text: prompt }] },
          ],
        },
        {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          timeout: 120_000,
        },
      );
      return (res.data?.content ?? [])
        .filter((b: any) => b?.type === "text")
        .map((b: any) => b.text)
        .join("\n");
    } catch (err: any) {
      const detail = err?.response?.data?.error?.message ?? err?.message;
      this.logger.error(`Anthropic call failed: ${detail}`);
      throw new ServiceUnavailableException(
        "Menu digitisation service is temporarily unavailable — try again.",
      );
    }
  }
```

- [ ] **Step 4: Rewrite parseMenuPhotos to use it**

`parseMenuPhotos` gövdesindeki `const model = …` satırından `catch` bloğunun sonuna kadar olan kısmı (bugün `menu-import.service.ts:122-160`) şununla değiştir:

```ts
    let text: string;
    try {
      text = await this.askClaude(imageBlocks, EXTRACTION_PROMPT);
    } catch (err) {
      // Failed vision call — refund the claim.
      await this.quota.voidUsage(usageId).catch(() => undefined);
      throw err;
    }
```

`parseMenuPhotos`'un başındaki `const apiKey = …` / `if (!apiKey) throw` bloğu **kalır** — kontör talep edilmeden önce anahtarsızlığı yakalamak gerekiyor, yoksa boşuna claim atılır.

- [ ] **Step 5: Run the whole file's tests**

Run: `cd backend && npx jest src/modules/menu/services/menu-import.service.spec.ts`
Expected: PASS — yeni test dahil hepsi

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/menu/services/menu-import.service.ts backend/src/modules/menu/services/menu-import.service.spec.ts
git commit -m "refactor(menu): tek Claude taşıması — askClaude()

Fotoğraf yolu ile gelecek link/PDF/CSV yolları aynı model, header, timeout
ve metin-birleştirme davranışını paylaşsın diye çağrı bloğu çıkarıldı.
Kontör talebi bilerek dışarıda: parçalı bir içe aktarma tek seferde N ünite
talep ediyor, bunu yalnız çağıran biliyor."
```

---

## Task 2: İçerik tipi tespiti

**Files:**
- Create: `backend/src/modules/menu/services/menu-source-sniff.ts`
- Test: `backend/src/modules/menu/services/menu-source-sniff.spec.ts`

**Interfaces:**
- Consumes: yok
- Produces: `export type SourceKind = "pdf" | "xlsx" | "csv" | "html"` ve `export function sniffSourceKind(bytes: Buffer, contentType?: string, filename?: string): SourceKind`

- [ ] **Step 1: Write the failing test**

```ts
import { sniffSourceKind } from "./menu-source-sniff";

describe("sniffSourceKind", () => {
  const pdf = Buffer.from("%PDF-1.7\nrest");
  const xlsx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);
  const csv = Buffer.from("Ad;Fiyat\nAyran;25\n");
  const html = Buffer.from("<!doctype html><html><body>menu</body></html>");

  it("magic bytes beat a lying Content-Type", () => {
    expect(sniffSourceKind(pdf, "application/octet-stream")).toBe("pdf");
    expect(sniffSourceKind(pdf, "text/html")).toBe("pdf");
    expect(sniffSourceKind(xlsx, "application/octet-stream")).toBe("xlsx");
  });

  it("falls back to Content-Type when there are no magic bytes", () => {
    expect(sniffSourceKind(csv, "text/csv")).toBe("csv");
    expect(sniffSourceKind(csv, "text/csv; charset=utf-8")).toBe("csv");
  });

  it("falls back to the filename extension when the header is useless", () => {
    expect(sniffSourceKind(csv, "application/octet-stream", "menu.csv")).toBe("csv");
    expect(sniffSourceKind(pdf, undefined, "menu.pdf")).toBe("pdf");
  });

  it("treats an unknown payload as html — the most tolerant path", () => {
    expect(sniffSourceKind(html, "text/html")).toBe("html");
    expect(sniffSourceKind(Buffer.from("who knows"), undefined)).toBe("html");
  });

  it("does not mistake a zip-based non-xlsx for a spreadsheet by extension alone", () => {
    expect(sniffSourceKind(xlsx, undefined, "archive.zip")).toBe("xlsx");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/modules/menu/services/menu-source-sniff.spec.ts`
Expected: FAIL — modül yok

- [ ] **Step 3: Implement**

```ts
/**
 * Decide what a fetched payload actually is.
 *
 * Priority is magic bytes → Content-Type → filename extension, in that order,
 * because servers lie constantly: a PDF arrives as application/octet-stream,
 * a CSV export arrives as text/html, and a link may carry no extension at
 * all. The bytes cannot lie about themselves.
 *
 * Anything we cannot identify falls through to "html", which is the most
 * tolerant path — it reduces whatever it got to text and hands it to the
 * model, rather than refusing outright.
 */
export type SourceKind = "pdf" | "xlsx" | "csv" | "html";

const startsWith = (buf: Buffer, sig: number[]) =>
  buf.length >= sig.length && sig.every((b, i) => buf[i] === b);

export function sniffSourceKind(
  bytes: Buffer,
  contentType?: string,
  filename?: string,
): SourceKind {
  // 1 — magic bytes.
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "pdf"; // %PDF
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "xlsx"; // PK.. (OOXML zip)
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) return "xlsx"; // legacy .xls (OLE2)

  // 2 — Content-Type, minus any charset parameter.
  const mime = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.ms-excel"
  ) {
    return "xlsx";
  }
  if (mime === "text/csv" || mime === "application/csv") return "csv";

  // 3 — filename extension.
  const ext = (filename ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === "pdf") return "pdf";
  if (ext === "xlsx" || ext === "xls") return "xlsx";
  if (ext === "csv" || ext === "tsv") return "csv";

  return "html";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/modules/menu/services/menu-source-sniff.spec.ts`
Expected: PASS (5 test)

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/menu/services/menu-source-sniff.ts backend/src/modules/menu/services/menu-source-sniff.spec.ts
git commit -m "feat(menu): kaynak içerik tipi tespiti

Sihirli baytlar > Content-Type > uzantı. Sunucular PDF'i octet-stream,
CSV'yi text/html diye servis edebiliyor; baytlar kendileri hakkında
yalan söyleyemez. Tanınmayan yük en toleranslı yola (html) düşer."
```

---

## Task 3: Güvenli getirici

**Files:**
- Create: `backend/src/modules/menu/services/menu-source-fetcher.service.ts`
- Test: `backend/src/modules/menu/services/menu-source-fetcher.service.spec.ts`

**Interfaces:**
- Consumes: `assertPublicHttpUrl`, `UnsafeUrlError` (`backend/src/common/net/url-safety.ts`), `numericEnv` (`backend/src/common/config/numeric-env.util.ts`)
- Produces: `export interface FetchedSource { bytes: Buffer; contentType?: string; filename?: string; finalUrl: string }` ve `MenuSourceFetcher.fetch(rawUrl: string): Promise<FetchedSource>` — güvensiz adres, tavan aşımı veya ağ hatasında `BadRequestException` fırlatır.

- [ ] **Step 1: Write the failing test**

```ts
jest.mock("axios");
import axios from "axios";
jest.mock("../../../common/net/url-safety");
import { assertPublicHttpUrl, UnsafeUrlError } from "../../../common/net/url-safety";
import { BadRequestException } from "@nestjs/common";
import { MenuSourceFetcher } from "./menu-source-fetcher.service";

describe("MenuSourceFetcher", () => {
  let svc: MenuSourceFetcher;
  const config = { get: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new MenuSourceFetcher(config as any);
    (assertPublicHttpUrl as jest.Mock).mockImplementation(async (u: string) => ({
      url: new URL(u),
      resolvedIp: "93.184.216.34",
    }));
  });

  it("validates the URL twice — once on entry, once before the socket", async () => {
    (axios.get as jest.Mock).mockResolvedValue({
      status: 200,
      data: Buffer.from("<html>ok</html>"),
      headers: { "content-type": "text/html" },
      request: { res: { responseUrl: "https://x.test/menu" } },
    });
    await svc.fetch("https://x.test/menu");
    expect((assertPublicHttpUrl as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("turns an unsafe URL into a 400 carrying the guard's message", async () => {
    (assertPublicHttpUrl as jest.Mock).mockRejectedValue(
      new UnsafeUrlError("URL resolves to a private address"),
    );
    await expect(svc.fetch("http://169.254.169.254/latest")).rejects.toThrow(
      BadRequestException,
    );
    await expect(svc.fetch("http://169.254.169.254/latest")).rejects.toThrow(
      /private address/,
    );
  });

  it("re-validates every redirect hop", async () => {
    (axios.get as jest.Mock).mockResolvedValue({
      status: 200,
      data: Buffer.from("x"),
      headers: {},
      request: { res: { responseUrl: "https://evil.test/final" } },
    });
    await svc.fetch("https://x.test/start");
    const checked = (assertPublicHttpUrl as jest.Mock).mock.calls.map((c) => c[0]);
    expect(checked).toContain("https://evil.test/final");
  });

  it("rejects a body over the cap", async () => {
    (axios.get as jest.Mock).mockResolvedValue({
      status: 200,
      data: Buffer.alloc(11 * 1024 * 1024),
      headers: {},
      request: { res: { responseUrl: "https://x.test/big" } },
    });
    await expect(svc.fetch("https://x.test/big")).rejects.toThrow(/too large/i);
  });

  it("normalises a Google Sheets edit link to its CSV export", async () => {
    (axios.get as jest.Mock).mockResolvedValue({
      status: 200,
      data: Buffer.from("Ad,Fiyat\n"),
      headers: { "content-type": "text/csv" },
      request: { res: { responseUrl: "https://docs.google.com/x" } },
    });
    await svc.fetch("https://docs.google.com/spreadsheets/d/ABC123/edit#gid=0");
    expect((axios.get as jest.Mock).mock.calls[0][0]).toBe(
      "https://docs.google.com/spreadsheets/d/ABC123/export?format=csv",
    );
  });

  it("detects a private Sheet answering 200 with a Google login page", async () => {
    (axios.get as jest.Mock).mockResolvedValue({
      status: 200,
      data: Buffer.from("<html><head><title>Sign in - Google Accounts</title>"),
      headers: { "content-type": "text/html" },
      request: { res: { responseUrl: "https://accounts.google.com/signin" } },
    });
    await expect(
      svc.fetch("https://docs.google.com/spreadsheets/d/ABC/export?format=csv"),
    ).rejects.toThrow(/herkese açık|not publicly/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/modules/menu/services/menu-source-fetcher.service.spec.ts`
Expected: FAIL — modül yok

- [ ] **Step 3: Implement**

```ts
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import {
  assertPublicHttpUrl,
  UnsafeUrlError,
} from "../../../common/net/url-safety";
import { numericEnv } from "../../../common/config/numeric-env.util";

export interface FetchedSource {
  bytes: Buffer;
  contentType?: string;
  filename?: string;
  finalUrl: string;
}

/**
 * Fetches the bytes behind an operator-supplied link.
 *
 * This is the one place in the menu module that makes the SERVER talk to an
 * address a USER chose, so it is the whole SSRF surface of the feature.
 * assertPublicHttpUrl runs twice — on entry and again on the URL we actually
 * landed on — because a malicious DNS record can answer public at validation
 * time and private at connect time, and because a redirect can walk us
 * somewhere the first check never saw. That two-phase shape is copied from
 * the outbound-webhook worker, which solved the same problem first.
 */
@Injectable()
export class MenuSourceFetcher {
  private readonly logger = new Logger(MenuSourceFetcher.name);

  constructor(private readonly config: ConfigService) {}

  private get timeoutMs() {
    return numericEnv(this.config?.get("MENU_SOURCE_TIMEOUT_MS"), 15_000);
  }
  private get maxBytes() {
    return numericEnv(this.config?.get("MENU_SOURCE_MAX_BYTES"), 10 * 1024 * 1024);
  }
  private get maxRedirects() {
    return numericEnv(this.config?.get("MENU_SOURCE_MAX_REDIRECTS"), 3);
  }

  async fetch(rawUrl: string): Promise<FetchedSource> {
    const target = normaliseGoogleSheets(rawUrl);

    await this.guard(target);

    let res: any;
    try {
      res = await axios.get(target, {
        responseType: "arraybuffer",
        timeout: this.timeoutMs,
        maxRedirects: this.maxRedirects,
        maxContentLength: this.maxBytes,
        maxBodyLength: this.maxBytes,
        decompress: true,
        validateStatus: (s: number) => s >= 200 && s < 300,
        headers: {
          // Some sites serve a stub to unknown agents. Be honest about who we
          // are rather than impersonating a browser.
          "user-agent": "HummyTummy-MenuImport/1.0 (+https://hummytummy.com)",
          accept: "*/*",
        },
      });
    } catch (err: any) {
      if (err?.code === "ERR_FR_MAX_BODY_LENGTH_EXCEEDED" || err?.message?.includes("maxContentLength")) {
        throw new BadRequestException("source is too large to import");
      }
      this.logger.warn(`menu source fetch failed: ${err?.message}`);
      throw new BadRequestException("could not fetch that link");
    }

    // Where we actually ended up after redirects — re-validate it.
    const finalUrl: string = res?.request?.res?.responseUrl ?? target;
    if (finalUrl !== target) await this.guard(finalUrl);

    const bytes = Buffer.from(res.data);
    if (bytes.length > this.maxBytes) {
      throw new BadRequestException("source is too large to import");
    }

    const contentType: string | undefined = res.headers?.["content-type"];
    assertSheetIsPublic(target, bytes, contentType);

    return {
      bytes,
      contentType,
      filename: filenameFrom(res.headers?.["content-disposition"], finalUrl),
      finalUrl,
    };
  }

  /** Validate, translating the guard's error into a client-safe 400. */
  private async guard(url: string): Promise<void> {
    try {
      await assertPublicHttpUrl(url);
    } catch (e) {
      throw new BadRequestException(
        e instanceof UnsafeUrlError ? e.message : "invalid URL",
      );
    }
  }
}

/**
 * A Google Sheets share link points at the editor, not the data. Rewrite it
 * to the CSV export so the operator can paste the link they actually have.
 */
export function normaliseGoogleSheets(raw: string): string {
  const m = raw.match(
    /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/,
  );
  if (!m) return raw;
  if (raw.includes("/export")) return raw;
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv`;
}

/**
 * A Sheet whose sharing is off does NOT 4xx — it answers 200 with a Google
 * sign-in page. Status codes cannot catch that, so look at what came back.
 */
export function assertSheetIsPublic(
  requestedUrl: string,
  bytes: Buffer,
  contentType?: string,
): void {
  if (!requestedUrl.includes("docs.google.com/spreadsheets")) return;
  const looksHtml =
    (contentType ?? "").includes("text/html") ||
    bytes.subarray(0, 200).toString("utf8").toLowerCase().includes("<html");
  if (looksHtml) {
    throw new BadRequestException(
      "that Google Sheet is not publicly readable — set link sharing to anyone with the link",
    );
  }
}

function filenameFrom(disposition?: string, url?: string): string | undefined {
  const fromHeader = disposition?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1];
  if (fromHeader) return decodeURIComponent(fromHeader);
  try {
    return url ? decodeURIComponent(new URL(url).pathname.split("/").pop() || "") || undefined : undefined;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/modules/menu/services/menu-source-fetcher.service.spec.ts`
Expected: PASS (6 test)

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/menu/services/menu-source-fetcher.service.ts backend/src/modules/menu/services/menu-source-fetcher.service.spec.ts
git commit -m "feat(menu): kaynak linki için güvenli getirici

Kullanıcının verdiği adrese sunucunun gittiği tek yer, yani özelliğin tüm
SSRF yüzeyi. assertPublicHttpUrl iki kez çalışıyor — girişte ve gerçekte
inilen adres için — çünkü DNS doğrulama anında public, bağlanma anında
private cevaplayabilir ve yönlendirme bizi ilk kontrolün görmediği bir
yere götürebilir. Desen outbound-webhook worker'ından alındı.

Sheets linki /edit ise CSV export'una çevriliyor; paylaşımı kapalı bir
sayfa 4xx değil 200 + Google giriş sayfası döndüğü için gövdeye bakılıyor."
```

---

## Task 4: Metin parçalayıcı ve taslak birleştirici

**Files:**
- Create: `backend/src/modules/menu/services/menu-text-chunker.ts`
- Test: `backend/src/modules/menu/services/menu-text-chunker.spec.ts`

**Interfaces:**
- Consumes: `CommitMenuImportDto` (`../dto/menu-import.dto`)
- Produces:
  - `export function chunkMenuText(text: string, opts?: { maxChars?: number; overlapLines?: number; maxChunks?: number }): string[]` — tavan aşılırsa `Error("source too long")`.
  - `export function mergeDrafts(drafts: CommitMenuImportDto[]): CommitMenuImportDto`

- [ ] **Step 1: Write the failing test**

```ts
import { chunkMenuText, mergeDrafts } from "./menu-text-chunker";

describe("chunkMenuText", () => {
  it("returns one chunk when the text fits", () => {
    expect(chunkMenuText("a\nb\nc", { maxChars: 100 })).toEqual(["a\nb\nc"]);
  });

  it("splits on line boundaries, never mid-line", () => {
    const text = Array.from({ length: 40 }, (_, i) => `line-${i}`).join("\n");
    const chunks = chunkMenuText(text, { maxChars: 60, overlapLines: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      for (const line of c.split("\n")) {
        expect(line).toMatch(/^line-\d+$|^$/);
      }
    }
  });

  it("overlaps consecutive chunks so a heading is never orphaned", () => {
    const text = Array.from({ length: 40 }, (_, i) => `line-${i}`).join("\n");
    const chunks = chunkMenuText(text, { maxChars: 60, overlapLines: 3 });
    const firstTail = chunks[0].split("\n").slice(-3);
    expect(chunks[1].split("\n").slice(0, 3)).toEqual(firstTail);
  });

  it("refuses rather than silently importing half the menu", () => {
    const text = Array.from({ length: 5000 }, (_, i) => `line-${i}`).join("\n");
    expect(() => chunkMenuText(text, { maxChars: 50, maxChunks: 3 })).toThrow(
      /too long/i,
    );
  });
});

describe("mergeDrafts", () => {
  it("merges products under the same category name, case-insensitively", () => {
    const merged = mergeDrafts([
      { categories: [{ name: "İçecekler", products: [{ name: "Ayran", price: 25 }] }] },
      { categories: [{ name: "içecekler", products: [{ name: "Kola", price: 30 }] }] },
    ]);
    expect(merged.categories).toHaveLength(1);
    expect(merged.categories[0].name).toBe("İçecekler");
    expect(merged.categories[0].products.map((p) => p.name)).toEqual(["Ayran", "Kola"]);
  });

  it("de-duplicates the products the overlap produced", () => {
    const merged = mergeDrafts([
      { categories: [{ name: "Ana", products: [{ name: "Kebap", price: 180 }] }] },
      { categories: [{ name: "Ana", products: [{ name: "kebap", price: 180 }, { name: "Pide", price: 120 }] }] },
    ]);
    expect(merged.categories[0].products.map((p) => p.name)).toEqual(["Kebap", "Pide"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/modules/menu/services/menu-text-chunker.spec.ts`
Expected: FAIL — modül yok

- [ ] **Step 3: Implement**

```ts
import { CommitMenuImportDto } from "../dto/menu-import.dto";

/**
 * The Claude call is capped at max_tokens 8000. A whole restaurant website or
 * a twelve-page PDF blows past that and the JSON comes back truncated, which
 * surfaces to the operator as a generic "menu could not be read".
 *
 * So split first. Splitting happens on line boundaries — never mid-line —
 * and consecutive chunks share their last few lines, because a category
 * heading landing exactly on a boundary would otherwise leave the products
 * beneath it with no heading to belong to. The overlap costs a few duplicate
 * products, which mergeDrafts removes.
 *
 * The chunk ceiling is a refusal, not a truncation: importing half a menu
 * silently is worse than saying the source is too long.
 */
export function chunkMenuText(
  text: string,
  opts: { maxChars?: number; overlapLines?: number; maxChunks?: number } = {},
): string[] {
  const maxChars = opts.maxChars ?? 24_000;
  const overlapLines = opts.overlapLines ?? 15;
  const maxChunks = opts.maxChunks ?? 6;

  if (text.length <= maxChars) return [text];

  const lines = text.split("\n");
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;

  for (const line of lines) {
    if (size + line.length + 1 > maxChars && current.length) {
      chunks.push(current.join("\n"));
      if (chunks.length >= maxChunks) throw new Error("source too long");
      const tail = overlapLines > 0 ? current.slice(-overlapLines) : [];
      current = [...tail];
      size = tail.reduce((n, l) => n + l.length + 1, 0);
    }
    current.push(line);
    size += line.length + 1;
  }
  if (current.length) chunks.push(current.join("\n"));
  if (chunks.length > maxChunks) throw new Error("source too long");
  return chunks;
}

/**
 * Fold per-chunk drafts into one. Categories match case-insensitively on the
 * trimmed name (the first spelling seen wins, so the menu keeps the source's
 * own capitalisation), and a product already present under that category is
 * dropped — that is how the chunk overlap stops being visible.
 */
export function mergeDrafts(drafts: CommitMenuImportDto[]): CommitMenuImportDto {
  const order: string[] = [];
  const byKey = new Map<string, { name: string; products: any[]; seen: Set<string> }>();

  for (const draft of drafts) {
    for (const cat of draft.categories ?? []) {
      const key = (cat.name ?? "").trim().toLowerCase();
      let bucket = byKey.get(key);
      if (!bucket) {
        bucket = { name: (cat.name ?? "").trim(), products: [], seen: new Set() };
        byKey.set(key, bucket);
        order.push(key);
      }
      for (const p of cat.products ?? []) {
        const pk = (p.name ?? "").trim().toLowerCase();
        if (!pk || bucket.seen.has(pk)) continue;
        bucket.seen.add(pk);
        bucket.products.push(p);
      }
    }
  }

  return {
    categories: order.map((k) => {
      const b = byKey.get(k)!;
      return { name: b.name, products: b.products };
    }),
  } as CommitMenuImportDto;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/modules/menu/services/menu-text-chunker.spec.ts`
Expected: PASS (6 test)

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/menu/services/menu-text-chunker.ts backend/src/modules/menu/services/menu-text-chunker.spec.ts
git commit -m "feat(menu): uzun kaynak için parçalama ve taslak birleştirme

max_tokens 8000 koca bir siteyi ya da çok sayfalı PDF'i taşırıyor ve JSON
ortadan kesiliyor. Bölme satır sınırında, ardışık parçalar son satırları
paylaşıyor — sınıra denk gelen kategori başlığının altındaki ürünler
başlıksız kalmasın diye. Örtüşmenin ürettiği yinelemeler birleştirmede
temizleniyor. Tavan aşımı sessiz kırpma değil, açık hata."
```

---

## Task 5: Tablo sütun eşleyici

**Files:**
- Create: `backend/src/modules/menu/services/menu-tabular-mapper.ts`
- Test: `backend/src/modules/menu/services/menu-tabular-mapper.spec.ts`

**Interfaces:**
- Consumes: `CommitMenuImportDto`
- Produces:
  - `export interface ColumnMap { name: string; price: string; category?: string; description?: string; taxRate?: string }`
  - `export function guessColumnMap(headers: string[]): ColumnMap | null` — güvenle tahmin edemezse `null` (çağıran modele sorar).
  - `export function rowsToDraft(headers: string[], rows: string[][], map: ColumnMap): CommitMenuImportDto`
  - `export function parsePrice(raw: string): number`

- [ ] **Step 1: Write the failing test**

```ts
import { guessColumnMap, rowsToDraft, parsePrice } from "./menu-tabular-mapper";

describe("parsePrice", () => {
  it("reads Turkish decimal commas and thousands dots", () => {
    expect(parsePrice("1.250,50")).toBe(1250.5);
    expect(parsePrice("25,90")).toBe(25.9);
  });
  it("reads plain and English-formatted numbers", () => {
    expect(parsePrice("180")).toBe(180);
    expect(parsePrice("1,250.50")).toBe(1250.5);
  });
  it("strips currency symbols and spaces", () => {
    expect(parsePrice("₺ 25,90")).toBe(25.9);
    expect(parsePrice("25.90 TL")).toBe(25.9);
  });
  it("returns 0 for unreadable input rather than NaN", () => {
    expect(parsePrice("")).toBe(0);
    expect(parsePrice("fiyat yok")).toBe(0);
  });
});

describe("guessColumnMap", () => {
  it("recognises Turkish headers", () => {
    expect(guessColumnMap(["Ürün Adı", "Açıklama", "Fiyat", "Kategori"])).toEqual({
      name: "Ürün Adı",
      description: "Açıklama",
      price: "Fiyat",
      category: "Kategori",
    });
  });
  it("recognises English headers", () => {
    const m = guessColumnMap(["Name", "Price"]);
    expect(m).toEqual({ name: "Name", price: "Price" });
  });
  it("returns null when name or price cannot be found", () => {
    expect(guessColumnMap(["Sütun A", "Sütun B"])).toBeNull();
    expect(guessColumnMap(["Ürün"])).toBeNull();
  });
});

describe("rowsToDraft", () => {
  const headers = ["Ad", "Fiyat", "Kategori"];
  const map = { name: "Ad", price: "Fiyat", category: "Kategori" };

  it("groups rows under their category", () => {
    const d = rowsToDraft(headers, [
      ["Ayran", "25", "İçecekler"],
      ["Kola", "30", "İçecekler"],
      ["Kebap", "180", "Ana Yemek"],
    ], map);
    expect(d.categories.map((c) => c.name)).toEqual(["İçecekler", "Ana Yemek"]);
    expect(d.categories[0].products).toHaveLength(2);
  });

  it("falls back to a single 'Menü' category when there is no category column", () => {
    const d = rowsToDraft(["Ad", "Fiyat"], [["Ayran", "25"]], { name: "Ad", price: "Fiyat" });
    expect(d.categories[0].name).toBe("Menü");
  });

  it("strips the leading apostrophe our own CSV export adds", () => {
    // csv.util.ts escapes formula-injection by prefixing '; on import it inverts.
    const d = rowsToDraft(headers, [["'=Ayran", "25", "İçecekler"]], map);
    expect(d.categories[0].products[0].name).toBe("=Ayran");
  });

  it("skips rows with no name", () => {
    const d = rowsToDraft(headers, [["", "25", "X"], ["Ayran", "25", "X"]], map);
    expect(d.categories[0].products).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/modules/menu/services/menu-tabular-mapper.spec.ts`
Expected: FAIL — modül yok

- [ ] **Step 3: Implement**

```ts
import { CommitMenuImportDto } from "../dto/menu-import.dto";

export interface ColumnMap {
  name: string;
  price: string;
  category?: string;
  description?: string;
  taxRate?: string;
}

const PATTERNS: Record<keyof ColumnMap, RegExp> = {
  name: /^(ürün\s*ad[ıi]|urun\s*ad[ıi]|ürün|urun|ad[ıi]?|isim|name|item|product|title)$/i,
  price: /^(fiyat|tutar|ücret|ucret|price|amount|cost)$/i,
  category: /^(kategori|grup|bölüm|bolum|category|group|section)$/i,
  description: /^(açıklama|aciklama|detay|description|desc|details)$/i,
  taxRate: /^(kdv|vergi|tax|vat|kdv\s*oran[ıi]|tax\s*rate)$/i,
};

/**
 * Recognise the columns from their headers alone. Returns null when the two
 * required ones (name, price) are not both identifiable — the caller then
 * spends one small model call asking for the mapping instead of guessing.
 */
export function guessColumnMap(headers: string[]): ColumnMap | null {
  const found: Partial<ColumnMap> = {};
  for (const h of headers) {
    const key = h.trim();
    for (const field of Object.keys(PATTERNS) as (keyof ColumnMap)[]) {
      if (!found[field] && PATTERNS[field].test(key)) {
        found[field] = key;
        break;
      }
    }
  }
  if (!found.name || !found.price) return null;
  return found as ColumnMap;
}

/**
 * Turn a price cell into a number.
 *
 * Turkish sheets write 1.250,50 and English ones write 1,250.50 — the same
 * two characters mean the opposite thing. Decide by which separator appears
 * last: that one is the decimal point.
 */
export function parsePrice(raw: string): number {
  const s = (raw ?? "").replace(/[^\d.,-]/g, "").trim();
  if (!s) return 0;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let normalised: string;
  if (lastComma > lastDot) {
    normalised = s.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    normalised = s.replace(/,/g, "");
  } else {
    normalised = s;
  }
  const n = Number(normalised);
  return Number.isFinite(n) ? n : 0;
}

/** Our own CSV export prefixes ' to defuse formula injection; undo it here. */
function cleanCell(v: string | undefined): string {
  const s = (v ?? "").trim();
  return s.startsWith("'") ? s.slice(1) : s;
}

export function rowsToDraft(
  headers: string[],
  rows: string[][],
  map: ColumnMap,
): CommitMenuImportDto {
  const idx = (col?: string) =>
    col ? headers.findIndex((h) => h.trim() === col.trim()) : -1;
  const iName = idx(map.name);
  const iPrice = idx(map.price);
  const iCat = idx(map.category);
  const iDesc = idx(map.description);
  const iTax = idx(map.taxRate);

  const order: string[] = [];
  const buckets = new Map<string, { name: string; products: any[] }>();

  for (const row of rows) {
    const name = cleanCell(row[iName]);
    if (!name) continue;

    const catName = (iCat >= 0 ? cleanCell(row[iCat]) : "") || "Menü";
    const key = catName.toLowerCase();
    if (!buckets.has(key)) {
      buckets.set(key, { name: catName, products: [] });
      order.push(key);
    }

    const taxRaw = iTax >= 0 ? parsePrice(row[iTax]) : NaN;
    buckets.get(key)!.products.push({
      name,
      description: iDesc >= 0 ? cleanCell(row[iDesc]) || undefined : undefined,
      price: parsePrice(row[iPrice]),
      taxRate: [0, 1, 10, 20].includes(taxRaw) ? taxRaw : undefined,
    });
  }

  return { categories: order.map((k) => buckets.get(k)!) } as CommitMenuImportDto;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/modules/menu/services/menu-tabular-mapper.spec.ts`
Expected: PASS (11 test)

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/menu/services/menu-tabular-mapper.ts backend/src/modules/menu/services/menu-tabular-mapper.spec.ts
git commit -m "feat(menu): tablo sütun eşleyici

Yapılandırılmış veride modeli satırların üstünde çalıştırmak hem gereksiz
hem riskli: yüzlerce satır token bütçesini yakıyor ve model sayıları yeniden
yazarken hata yapabiliyor. Başlıklar tanınıyorsa eşleme yerelde çıkarılır.

parsePrice, 1.250,50 ile 1,250.50'yi son ayraca bakarak ayırıyor — aynı iki
karakter iki dilde ters anlama geliyor. Kendi CSV ihracatımızın formül
enjeksiyonuna karşı eklediği baştaki tek tırnak ithalatta geri alınıyor."
```

---

## Task 6: Kaynak servisi — üç çıkarıcıyı bağla

**Files:**
- Create: `backend/src/modules/menu/services/menu-source.service.ts`
- Test: `backend/src/modules/menu/services/menu-source.service.spec.ts`
- Modify: `backend/package.json` (bağımlılık)

**Interfaces:**
- Consumes: `MenuSourceFetcher.fetch`, `sniffSourceKind`, `chunkMenuText`, `mergeDrafts`, `guessColumnMap`, `rowsToDraft`, `MenuImportService.askClaude` (Task 1), `MenuAiQuotaService`
- Produces: `MenuSourceService.parseSource(tenantId: string, input: { url?: string; file?: { buffer: Buffer; mimetype: string; originalname: string } }): Promise<CommitMenuImportDto>`

**Not:** `askClaude` bugün `private`. Bu görevde `MenuImportService` üzerinde `parseTextToDraft(text: string): Promise<CommitMenuImportDto>` ve `parseDocumentToDraft(bytes, mediaType)` adında iki **public** metoda dönüştürülür; `MenuSourceService` onları çağırır. Böylece `askClaude` private kalır ve `normaliseDraft` de tek yerde kalır.

- [ ] **Step 1: Add the dependencies**

XLSX okuyucu seçimi: **`exceljs`** kullanılacak. Gerekçe: npm'deki `xlsx` (SheetJS) paketi uzun süredir npm kanalında güncellenmiyor ve bilinen prototype-pollution/ReDoS geçmişi var; girdi doğrudan kullanıcı dosyası olduğu için bakımı süren paket tercih edilir.

```bash
cd backend && npm install csv-parse exceljs
```

- [ ] **Step 2: Write the failing test**

```ts
import { MenuSourceService } from "./menu-source.service";

describe("MenuSourceService", () => {
  let svc: MenuSourceService;
  let fetcher: { fetch: jest.Mock };
  let importSvc: { parseTextToDraft: jest.Mock; parseDocumentToDraft: jest.Mock };
  let quota: { claim: jest.Mock; attachJob: jest.Mock; voidUsage: jest.Mock };

  const TENANT = "t1";

  beforeEach(() => {
    fetcher = { fetch: jest.fn() };
    importSvc = {
      parseTextToDraft: jest.fn().mockResolvedValue({
        categories: [{ name: "Menü", products: [{ name: "Ayran", price: 25 }] }],
      }),
      parseDocumentToDraft: jest.fn().mockResolvedValue({
        categories: [{ name: "PDF", products: [{ name: "Kebap", price: 180 }] }],
      }),
    };
    quota = {
      claim: jest.fn().mockResolvedValue("usage1"),
      attachJob: jest.fn().mockResolvedValue(undefined),
      voidUsage: jest.fn().mockResolvedValue(undefined),
    };
    svc = new MenuSourceService(fetcher as any, importSvc as any, quota as any);
  });

  it("routes a CSV to the local mapper and never calls the model", async () => {
    fetcher.fetch.mockResolvedValue({
      bytes: Buffer.from("Ad,Fiyat,Kategori\nAyran,25,İçecekler\n"),
      contentType: "text/csv",
      filename: "menu.csv",
      finalUrl: "https://x.test/menu.csv",
    });

    const draft = await svc.parseSource(TENANT, { url: "https://x.test/menu.csv" });

    expect(draft.categories[0].name).toBe("İçecekler");
    expect(draft.categories[0].products[0].price).toBe(25);
    expect(importSvc.parseTextToDraft).not.toHaveBeenCalled();
    expect(quota.claim).not.toHaveBeenCalled();
  });

  it("routes a PDF to the document path and claims one unit", async () => {
    fetcher.fetch.mockResolvedValue({
      bytes: Buffer.from("%PDF-1.7 ..."),
      contentType: "application/pdf",
      filename: "menu.pdf",
      finalUrl: "https://x.test/menu.pdf",
    });

    const draft = await svc.parseSource(TENANT, { url: "https://x.test/menu.pdf" });

    expect(importSvc.parseDocumentToDraft).toHaveBeenCalled();
    expect(quota.claim).toHaveBeenCalledWith(TENANT, "PHOTO", 1);
    expect(draft.categories[0].name).toBe("PDF");
  });

  it("strips script/style from HTML before handing text to the model", async () => {
    fetcher.fetch.mockResolvedValue({
      bytes: Buffer.from(
        "<html><head><style>.a{}</style><script>var x=1</script></head><body><h2>İçecekler</h2><p>Ayran 25</p></body></html>",
      ),
      contentType: "text/html",
      finalUrl: "https://x.test/",
    });

    await svc.parseSource(TENANT, { url: "https://x.test/" });

    const text = importSvc.parseTextToDraft.mock.calls[0][0] as string;
    expect(text).toContain("İçecekler");
    expect(text).not.toContain("var x=1");
    expect(text).not.toContain(".a{}");
  });

  it("refunds every claimed unit when a chunk fails", async () => {
    fetcher.fetch.mockResolvedValue({
      bytes: Buffer.from("<html><body>" + "satır\n".repeat(20000) + "</body></html>"),
      contentType: "text/html",
      finalUrl: "https://x.test/",
    });
    importSvc.parseTextToDraft.mockRejectedValue(new Error("boom"));

    await expect(svc.parseSource(TENANT, { url: "https://x.test/" })).rejects.toThrow();
    expect(quota.voidUsage).toHaveBeenCalledWith("usage1");
  });

  it("rejects when neither url nor file is given", async () => {
    await expect(svc.parseSource(TENANT, {})).rejects.toThrow(/url or file/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx jest src/modules/menu/services/menu-source.service.spec.ts`
Expected: FAIL — modül yok

- [ ] **Step 4: Implement**

```ts
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { parse as parseCsv } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { MenuSourceFetcher } from "./menu-source-fetcher.service";
import { MenuImportService } from "./menu-import.service";
import { MenuAiQuotaService } from "./menu-ai-quota.service";
import { sniffSourceKind } from "./menu-source-sniff";
import { chunkMenuText, mergeDrafts } from "./menu-text-chunker";
import { guessColumnMap, rowsToDraft, type ColumnMap } from "./menu-tabular-mapper";
import { CommitMenuImportDto } from "../dto/menu-import.dto";

const COLUMN_MAP_PROMPT = `You are mapping a spreadsheet's columns onto a restaurant menu import.

Return ONLY this JSON, using the EXACT header strings from the input:
{ "name": "<header holding the item name>",
  "price": "<header holding the price>",
  "category": "<header holding the section/category, or null>",
  "description": "<header holding the description, or null>",
  "taxRate": "<header holding the KDV/VAT rate, or null>" }

Rules:
- name and price are REQUIRED. If you cannot identify both, return {"name": null, "price": null}.
- Use null, not an empty string, for a column that is not present.
- Return ONLY the JSON object, no prose, no markdown fences.`;

/**
 * Turns "a link or a file" into the same draft the photo importer produces.
 *
 * The routing rule that matters: structured sources (CSV/XLSX) never reach
 * the model row by row. Only the header row plus a few samples go, and only
 * to learn which column is which — the rows themselves are mapped locally.
 * That is both cheaper and more accurate than asking a model to retype
 * several hundred prices.
 */
@Injectable()
export class MenuSourceService {
  private readonly logger = new Logger(MenuSourceService.name);

  constructor(
    private readonly fetcher: MenuSourceFetcher,
    private readonly importSvc: MenuImportService,
    private readonly quota: MenuAiQuotaService,
  ) {}

  async parseSource(
    tenantId: string,
    input: {
      url?: string;
      file?: { buffer: Buffer; mimetype: string; originalname: string };
    },
  ): Promise<CommitMenuImportDto> {
    if (!input.url && !input.file) {
      throw new BadRequestException("either a url or a file is required");
    }

    const source = input.file
      ? {
          bytes: input.file.buffer,
          contentType: input.file.mimetype,
          filename: input.file.originalname,
        }
      : await this.fetcher.fetch(input.url!);

    const kind = sniffSourceKind(source.bytes, source.contentType, source.filename);

    switch (kind) {
      case "csv":
        return this.fromRows(tenantId, csvToRows(source.bytes));
      case "xlsx":
        return this.fromRows(tenantId, await xlsxToRows(source.bytes));
      case "pdf":
        return this.metered(tenantId, 1, () =>
          this.importSvc.parseDocumentToDraft(source.bytes, "application/pdf"),
        );
      case "html":
      default:
        return this.fromText(tenantId, htmlToText(source.bytes.toString("utf8")));
    }
  }

  /** Long text → chunked model calls → merged draft. One unit per chunk. */
  private async fromText(tenantId: string, text: string): Promise<CommitMenuImportDto> {
    if (!text.trim()) {
      throw new BadRequestException("nothing readable at that link");
    }
    let chunks: string[];
    try {
      chunks = chunkMenuText(text);
    } catch {
      throw new BadRequestException(
        "that source is too long to import in one go — try a single menu page",
      );
    }
    return this.metered(tenantId, chunks.length, async () => {
      const drafts: CommitMenuImportDto[] = [];
      for (const chunk of chunks) {
        drafts.push(await this.importSvc.parseTextToDraft(chunk));
      }
      return mergeDrafts(drafts);
    });
  }

  /** Header + rows → column map (local, or one small model call) → draft. */
  private async fromRows(tenantId: string, table: string[][]): Promise<CommitMenuImportDto> {
    if (table.length < 2) {
      throw new BadRequestException("that file has no data rows");
    }
    const [headers, ...rows] = table;

    let map = guessColumnMap(headers);
    if (!map) {
      // Headers we do not recognise — spend exactly one unit asking which
      // column is which, then map every row locally.
      map = await this.metered(tenantId, 1, async () => {
        const sample = [headers, ...rows.slice(0, 5)]
          .map((r) => r.join(" | "))
          .join("\n");
        const answer = await this.importSvc.parseColumnMap(sample, COLUMN_MAP_PROMPT);
        if (!answer?.name || !answer?.price) {
          throw new BadRequestException(
            "could not tell which columns hold the item name and price",
          );
        }
        return answer as ColumnMap;
      });
    }
    return rowsToDraft(headers, rows, map);
  }

  /**
   * Claim up front, refund the whole claim on any failure. The operator got
   * nothing, so they pay nothing — same contract parseMenuPhotos honours.
   */
  private async metered<T>(tenantId: string, units: number, fn: () => Promise<T>): Promise<T> {
    const usageId = await this.quota.claim(tenantId, "PHOTO", units);
    await this.quota.attachJob(usageId, `menu-source:${usageId}`).catch(() => undefined);
    try {
      return await fn();
    } catch (err) {
      await this.quota.voidUsage(usageId).catch(() => undefined);
      throw err;
    }
  }
}

/** Reduce an HTML document to the text a human would read off the page. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

export function csvToRows(bytes: Buffer): string[][] {
  const text = bytes.toString("utf8").replace(/^﻿/, "");
  // Let csv-parse work out , vs ; vs tab — Turkish exports use ; routinely.
  return parseCsv(text, {
    delimiter: [",", ";", "\t"],
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  }) as string[][];
}

export async function xlsxToRows(bytes: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as any);
  const sheet = wb.worksheets[0];
  if (!sheet) return [];
  const out: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as any[];
    // exceljs pads index 0; drop it and stringify each cell.
    out.push(values.slice(1).map((v) => (v == null ? "" : String(v?.text ?? v?.result ?? v))));
  });
  return out;
}
```

- [ ] **Step 5: Add the three public seams on MenuImportService**

`menu-import.service.ts`'e ekle:

```ts
  /** Text (a page, a chunk of one) → draft. Not metered — the caller meters. */
  async parseTextToDraft(text: string): Promise<CommitMenuImportDto> {
    const answer = await this.askClaude(
      [{ type: "text", text }],
      EXTRACTION_PROMPT,
    );
    return this.normaliseDraft(answer);
  }

  /** A PDF (or any Claude-supported document) → draft. Not metered. */
  async parseDocumentToDraft(
    bytes: Buffer,
    mediaType: string,
  ): Promise<CommitMenuImportDto> {
    const answer = await this.askClaude(
      [
        {
          type: "document",
          source: { type: "base64", media_type: mediaType, data: bytes.toString("base64") },
        },
      ],
      EXTRACTION_PROMPT,
    );
    return this.normaliseDraft(answer);
  }

  /** Header + sample rows → which column is which. Not metered. */
  async parseColumnMap(
    sample: string,
    prompt: string,
  ): Promise<Record<string, string | null>> {
    const answer = await this.askClaude([{ type: "text", text: sample }], prompt);
    const cleaned = answer.replace(/```json\s*|\s*```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) {
      throw new BadRequestException("could not read the column mapping");
    }
    return JSON.parse(cleaned.slice(start, end + 1));
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && npx jest src/modules/menu/services/menu-source.service.spec.ts`
Expected: PASS (5 test)

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/menu/services/menu-source.service.ts backend/src/modules/menu/services/menu-source.service.spec.ts backend/src/modules/menu/services/menu-import.service.ts backend/package.json backend/package-lock.json
git commit -m "feat(menu): kaynak yönlendiricisi — CSV/XLSX/PDF/HTML

Yapılandırılmış kaynaklarda satırlar modele hiç gitmiyor: yalnız başlık
satırı + birkaç örnek gidiyor, o da sadece hangi sütunun ne olduğunu
öğrenmek için; satırlar yerelde eşleniyor. Yüzlerce fiyatı modele yeniden
yazdırmaktan hem ucuz hem doğru.

XLSX için exceljs seçildi: npm'deki xlsx (SheetJS) uzun süredir o kanalda
güncellenmiyor ve girdi doğrudan kullanıcı dosyası."
```

---

## Task 7: Çakışma tespiti ve commit dalları

**Files:**
- Modify: `backend/src/modules/menu/dto/menu-import.dto.ts`
- Modify: `backend/src/modules/menu/services/menu-import.service.ts` (`commitDraft`, yeni `annotateConflicts`)
- Test: `backend/src/modules/menu/services/menu-import.service.spec.ts`

**Interfaces:**
- Consumes: `CommitMenuImportDto`
- Produces:
  - DTO: `onConflict?: "SKIP" | "UPDATE_PRICE" | "CREATE"`, `existingProductId?: string`
  - `MenuImportService.annotateConflicts(draft: CommitMenuImportDto, tenantId: string): Promise<CommitMenuImportDto>`
  - `ProductsService.update(id, dto, tenantId)` zaten mevcut ve içinde `findOne(id, tenantId)` ile sahiplik doğruluyor — yeni bir metot gerekmiyor.
  - `CommitSummary` kazanır: `productsUpdated: number`, `productsSkipped: number`

- [ ] **Step 1: Write the failing test**

```ts
  describe("conflicts", () => {
    it("annotates a draft row that already exists in the same category", async () => {
      (prisma.product.findMany as any).mockResolvedValue([
        { id: "p1", name: "Ayran", price: 20, category: { name: "İçecekler" } },
      ]);
      const draft = {
        categories: [
          { name: "içecekler", products: [{ name: " ayran ", price: 25 }, { name: "Kola", price: 30 }] },
        ],
      };

      const out = await svc.annotateConflicts(draft as any, TENANT);

      expect(out.categories[0].products[0]).toMatchObject({
        existingProductId: "p1",
        onConflict: "SKIP",
      });
      expect(out.categories[0].products[1].existingProductId).toBeUndefined();
    });

    it("does not match the same name in a different category", async () => {
      (prisma.product.findMany as any).mockResolvedValue([
        { id: "p1", name: "Ayran", price: 20, category: { name: "İçecekler" } },
      ]);
      const out = await svc.annotateConflicts(
        { categories: [{ name: "Menüler", products: [{ name: "Ayran", price: 25 }] }] } as any,
        TENANT,
      );
      expect(out.categories[0].products[0].existingProductId).toBeUndefined();
    });

    it("SKIP creates nothing and counts as skipped", async () => {
      (prisma.category.findMany as any).mockResolvedValue([{ id: "c1", name: "İçecekler" }]);
      const s = await svc.commitDraft(
        { categories: [{ name: "İçecekler", products: [
          { name: "Ayran", price: 25, onConflict: "SKIP", existingProductId: "p1" },
        ] }] } as any,
        TENANT,
      );
      expect(products.create).not.toHaveBeenCalled();
      expect(s.productsSkipped).toBe(1);
      expect(s.productsCreated).toBe(0);
    });

    it("UPDATE_PRICE touches only the price", async () => {
      (prisma.category.findMany as any).mockResolvedValue([{ id: "c1", name: "İçecekler" }]);
      (prisma.product.findFirst as any).mockResolvedValue({ id: "p1", tenantId: TENANT });
      const s = await svc.commitDraft(
        { categories: [{ name: "İçecekler", products: [
          { name: "Ayran", price: 25, description: "yeni", onConflict: "UPDATE_PRICE", existingProductId: "p1" },
        ] }] } as any,
        TENANT,
      );
      expect(products.update).toHaveBeenCalledWith("p1", { price: 25 }, TENANT);
      expect(s.productsUpdated).toBe(1);
    });

    it("refuses to update a product belonging to another tenant", async () => {
      (prisma.category.findMany as any).mockResolvedValue([{ id: "c1", name: "İçecekler" }]);
      (prisma.product.findFirst as any).mockResolvedValue(null); // not found for THIS tenant
      const s = await svc.commitDraft(
        { categories: [{ name: "İçecekler", products: [
          { name: "Ayran", price: 25, onConflict: "UPDATE_PRICE", existingProductId: "someone-elses" },
        ] }] } as any,
        TENANT,
      );
      expect(products.update).not.toHaveBeenCalled();
      expect(s.failures[0].reason).toMatch(/not found/i);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/modules/menu/services/menu-import.service.spec.ts -t conflicts`
Expected: FAIL — `svc.annotateConflicts is not a function`

- [ ] **Step 3: Extend the DTO**

`menu-import.dto.ts`, `MenuImportProductDraftDto` içine ekle:

```ts
  /**
   * What to do when this row already exists in the target category. The
   * server annotates the row on parse; the operator may change it in the
   * review grid. Absent means CREATE — that is what every pre-conflict
   * caller (BulkAddModal, the photo flow) sends, and it keeps their
   * behaviour byte-identical.
   */
  @ApiProperty({ required: false, enum: ["SKIP", "UPDATE_PRICE", "CREATE"] })
  @IsOptional()
  @IsIn(["SKIP", "UPDATE_PRICE", "CREATE"])
  onConflict?: "SKIP" | "UPDATE_PRICE" | "CREATE";

  /** The product this row collided with. Re-checked server-side. */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  existingProductId?: string;
```

- [ ] **Step 4: Add annotateConflicts**

`menu-import.service.ts`'e ekle:

```ts
  /**
   * Mark the draft rows that already exist, so the review grid can offer a
   * choice instead of silently doubling the menu.
   *
   * Matching is scoped to the category, not the whole menu: "Ayran" can
   * legitimately live in both İçecekler and Menüler and those are two
   * different products. A draft category the tenant does not have yet can
   * therefore never collide.
   */
  async annotateConflicts(
    draft: CommitMenuImportDto,
    tenantId: string,
  ): Promise<CommitMenuImportDto> {
    const existing = await this.prisma.product.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true, price: true, category: { select: { name: true } } },
    });

    const key = (cat: string, name: string) =>
      `${cat.trim().toLowerCase()} ${name.trim().toLowerCase()}`;

    const index = new Map<string, { id: string; price: number }>();
    for (const p of existing) {
      if (!p.category?.name) continue;
      index.set(key(p.category.name, p.name), { id: p.id, price: Number(p.price) });
    }

    return {
      categories: draft.categories.map((c) => ({
        ...c,
        products: c.products.map((p) => {
          const hit = index.get(key(c.name, p.name));
          if (!hit) return p;
          return {
            ...p,
            existingProductId: hit.id,
            existingPrice: hit.price,
            onConflict: "SKIP" as const,
          };
        }),
      })),
    } as CommitMenuImportDto;
  }
```

- [ ] **Step 5: Add the commit branches**

`commitDraft` içindeki ürün döngüsünü (`for (const p of cat.products) { try { await this.products.create(...` bloğu) şununla değiştir:

```ts
      for (const p of cat.products) {
        const action = p.existingProductId ? (p.onConflict ?? "SKIP") : "CREATE";

        if (action === "SKIP") {
          summary.productsSkipped++;
          continue;
        }

        if (action === "UPDATE_PRICE") {
          try {
            // products.update already calls findOne(id, tenantId), so a
            // foreign id cannot be written. Checking first anyway turns that
            // into a per-row failure the operator can see, instead of a
            // thrown 404 that aborts the rest of the import.
            const owned = await this.prisma.product.findFirst({
              where: { id: p.existingProductId, tenantId, deletedAt: null },
              select: { id: true },
            });
            if (!owned) {
              summary.failures.push({
                category: cat.name,
                product: p.name,
                reason: "product not found",
              });
              continue;
            }
            await this.products.update(p.existingProductId!, { price: p.price } as any, tenantId);
            summary.productsUpdated++;
          } catch (err: any) {
            summary.failures.push({
              category: cat.name,
              product: p.name,
              reason: err?.message ?? "unknown",
            });
          }
          continue;
        }

        try {
          await this.products.create(
            {
              name: p.name,
              description: p.description,
              price: p.price,
              taxRate: p.taxRate ?? 10,
              categoryId,
            } as any,
            tenantId,
          );
          summary.productsCreated++;
        } catch (err: any) {
          summary.failures.push({
            category: cat.name,
            product: p.name,
            reason: err?.message ?? "unknown",
          });
        }
      }
```

`CommitSummary` arayüzüne iki alan ekle ve `commitDraft` içindeki başlangıç nesnesinde sıfırla:

```ts
export interface CommitSummary {
  categoriesCreated: number;
  categoriesMatched: number;
  productsCreated: number;
  productsUpdated: number;
  productsSkipped: number;
  failures: { category: string; product: string; reason: string }[];
}
```

Ayrıca plan-limiti ön kontrolü artık yalnız **gerçekten yaratılacak** satırları saymalı — `totalProducts` hesabını değiştir:

```ts
    const totalProducts = dto.categories.reduce(
      (n, c) =>
        n +
        c.products.filter(
          (p) => !p.existingProductId || (p.onConflict ?? "SKIP") === "CREATE",
        ).length,
      0,
    );
```

- [ ] **Step 6: Run the tests**

Run: `cd backend && npx jest src/modules/menu/services/menu-import.service.spec.ts`
Expected: PASS — yeni 5 test ve mevcut testlerin tamamı. Mevcut testler `productsSkipped`/`productsUpdated` beklemiyorsa da geçer (yalnız yeni alanlar eklendi).

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/menu/dto/menu-import.dto.ts backend/src/modules/menu/services/menu-import.service.ts backend/src/modules/menu/services/menu-import.service.spec.ts
git commit -m "feat(menu): çakışan ürünlerde atla / fiyatı güncelle / yine de ekle

commitDraft bugüne dek kategorileri eşliyor ama ürünleri her zaman yeniden
yaratıyordu; dolu bir menüye 'tüm ürünleri ekle' demek menüyü ikiye
katlıyordu. Artık parse dönerken çakışan satırlar işaretleniyor ve operatör
seçiyor, varsayılan atla.

Eşleştirme kategori kapsamlı: Ayran hem İçecekler'de hem Menüler'de olabilir
ve bunlar ayrı ürünler. existingProductId istemciden geldiği için güncelleme
öncesi tenant sahipliği sunucuda yeniden doğrulanıyor.

Plan-limiti ön kontrolü artık yalnız gerçekten yaratılacak satırları sayıyor."
```

---

## Task 8: Uç ve modül bağlantısı

**Files:**
- Modify: `backend/src/modules/menu/controllers/menu-import.controller.ts`
- Modify: `backend/src/modules/menu/menu.module.ts`
- Create: `backend/src/modules/menu/dto/parse-menu-source.dto.ts`
- Test: `backend/src/modules/menu/controllers/menu-import.controller.spec.ts`

**Interfaces:**
- Consumes: `MenuSourceService.parseSource`, `MenuImportService.annotateConflicts`
- Produces: `POST /menu/import/parse-source`

- [ ] **Step 1: Create the DTO**

`backend/src/modules/menu/dto/parse-menu-source.dto.ts`:

```ts
import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

export class ParseMenuSourceDto {
  /**
   * The link to import from. Optional because the same endpoint also accepts
   * a directly-uploaded file; the service rejects a request carrying neither.
   */
  @ApiProperty({ required: false, example: "https://restoran.com/menu" })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string;
}
```

- [ ] **Step 2: Write the failing test**

```ts
import { MenuImportController } from "./menu-import.controller";

describe("MenuImportController parse-source", () => {
  const menuImport = { annotateConflicts: jest.fn((d) => Promise.resolve(d)) };
  const menuSource = { parseSource: jest.fn() };
  const ctrl = new MenuImportController(menuImport as any, menuSource as any);

  it("passes a url through and annotates conflicts before returning", async () => {
    menuSource.parseSource.mockResolvedValue({ categories: [] });
    await ctrl.parseSource({ url: "https://x.test/menu" } as any, [], { tenantId: "t1" } as any);
    expect(menuSource.parseSource).toHaveBeenCalledWith("t1", {
      url: "https://x.test/menu",
      file: undefined,
    });
    expect(menuImport.annotateConflicts).toHaveBeenCalled();
  });

  it("passes an uploaded file through instead", async () => {
    menuSource.parseSource.mockResolvedValue({ categories: [] });
    const file = { buffer: Buffer.from("x"), mimetype: "application/pdf", originalname: "m.pdf" };
    await ctrl.parseSource({} as any, [file] as any, { tenantId: "t1" } as any);
    expect(menuSource.parseSource).toHaveBeenCalledWith("t1", { url: undefined, file });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx jest src/modules/menu/controllers/menu-import.controller.spec.ts`
Expected: FAIL — `ctrl.parseSource is not a function`

- [ ] **Step 4: Add the endpoint**

`menu-import.controller.ts` — kurucuya `MenuSourceService` ekle ve şu metodu koy:

```ts
  // Same gate as photo parse: this is an AI call and it costs a credit.
  // commit below stays ungated, as it already is.
  @Post("parse-source")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.AI_CONTENT_GENERATION)
  @ApiConsumes("multipart/form-data", "application/json")
  @ApiOperation({
    summary: "Import a menu from a link or an uploaded PDF/CSV/XLSX (no persistence)",
  })
  @UseInterceptors(
    FilesInterceptor("file", 1, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }),
  )
  async parseSource(
    @Body() dto: ParseMenuSourceDto,
    @UploadedFiles() files: Array<Express.Multer.File>,
    @Request() req,
  ) {
    const f = (files ?? [])[0];
    const draft = await this.menuSource.parseSource(req.tenantId, {
      url: dto.url,
      file: f
        ? { buffer: f.buffer, mimetype: f.mimetype, originalname: f.originalname }
        : undefined,
    });
    // Mark what already exists so the grid can offer a choice.
    return this.menuImport.annotateConflicts(draft, req.tenantId);
  }
```

- [ ] **Step 5: Wire the module**

`menu.module.ts` `providers` dizisine ekle:

```ts
    MenuSourceService,
    MenuSourceFetcher,
```

ve karşılık gelen `import` satırlarını dosyanın başına.

- [ ] **Step 6: Run tests + typecheck**

Run: `cd backend && npx jest src/modules/menu && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc çıkış 0

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/menu/controllers/menu-import.controller.ts backend/src/modules/menu/controllers/menu-import.controller.spec.ts backend/src/modules/menu/dto/parse-menu-source.dto.ts backend/src/modules/menu/menu.module.ts
git commit -m "feat(menu): POST /menu/import/parse-source

Link ya da yüklenen dosya alır, taslak döndürür, hiçbir şey kalıcılaştırmaz.
Fotoğraf parse'ıyla aynı kapı: AI çağrısı ve kontör harcıyor. commit ucu
bilerek kapısız kalmaya devam ediyor."
```

---

## Task 9: İnceleme ızgarasını bileşene çıkar

**Files:**
- Create: `frontend/src/pages/admin/menuManagement/useMenuDraft.ts`
- Create: `frontend/src/pages/admin/menuManagement/MenuDraftReviewGrid.tsx`
- Modify: `frontend/src/pages/admin/menuManagement/MenuImportTab.tsx`
- Modify: `frontend/src/features/menu/menuApi.ts`
- Test: `frontend/src/pages/admin/menuManagement/MenuDraftReviewGrid.test.tsx`

**Interfaces:**
- Consumes: `MenuImportDraft`, `MenuImportCommitSummary` (`features/menu/menuApi`)
- Produces:
  - `menuApi.ts`: `MenuImportProductDraft` kazanır `onConflict?: "SKIP" | "UPDATE_PRICE" | "CREATE"`, `existingProductId?: string`, `existingPrice?: number`; `MenuImportCommitSummary` kazanır `productsUpdated: number`, `productsSkipped: number`.
  - `useMenuDraft(): { draft, setDraft, totalItems, invalidRowCount, conflictCount, updateProduct, updateCategoryName, removeProduct, removeCategory, addProduct, setAllConflictPolicy, cleanForCommit }`
  - `<MenuDraftReviewGrid draft controls onCommit onCancel isCommitting />`

- [ ] **Step 1: Extend the API types**

`menuApi.ts:384-402`:

```ts
export type ConflictPolicy = "SKIP" | "UPDATE_PRICE" | "CREATE";

export interface MenuImportProductDraft {
  name: string;
  description?: string;
  price: number;
  taxRate?: number;
  /** Set by the server when this row already exists in the target category. */
  existingProductId?: string;
  existingPrice?: number;
  onConflict?: ConflictPolicy;
}
export interface MenuImportCategoryDraft {
  name: string;
  products: MenuImportProductDraft[];
}
export interface MenuImportDraft {
  categories: MenuImportCategoryDraft[];
}
export interface MenuImportCommitSummary {
  categoriesCreated: number;
  categoriesMatched: number;
  productsCreated: number;
  productsUpdated: number;
  productsSkipped: number;
  failures: { category: string; product: string; reason: string }[];
}
```

- [ ] **Step 2: Write the failing test**

`MenuDraftReviewGrid.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MenuDraftReviewGrid from "./MenuDraftReviewGrid";
import { useMenuDraft } from "./useMenuDraft";
import { renderHook, act } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, d?: any) => (typeof d === "string" ? d : d?.defaultValue ?? k),
  }),
}));

describe("useMenuDraft", () => {
  it("counts conflicting rows separately from invalid ones", () => {
    const { result } = renderHook(() => useMenuDraft());
    act(() =>
      result.current.setDraft({
        categories: [
          {
            name: "İçecekler",
            products: [
              { name: "Ayran", price: 25, existingProductId: "p1", onConflict: "SKIP" },
              { name: "", price: 30 },
            ],
          },
        ],
      }),
    );
    expect(result.current.conflictCount).toBe(1);
    expect(result.current.invalidRowCount).toBe(1);
    expect(result.current.totalItems).toBe(2);
  });

  it("setAllConflictPolicy rewrites only the conflicting rows", () => {
    const { result } = renderHook(() => useMenuDraft());
    act(() =>
      result.current.setDraft({
        categories: [
          {
            name: "X",
            products: [
              { name: "A", price: 1, existingProductId: "p1", onConflict: "SKIP" },
              { name: "B", price: 2 },
            ],
          },
        ],
      }),
    );
    act(() => result.current.setAllConflictPolicy("UPDATE_PRICE"));
    expect(result.current.draft!.categories[0].products[0].onConflict).toBe("UPDATE_PRICE");
    expect(result.current.draft!.categories[0].products[1].onConflict).toBeUndefined();
  });

  it("cleanForCommit drops SKIP rows and empty categories", () => {
    const { result } = renderHook(() => useMenuDraft());
    act(() =>
      result.current.setDraft({
        categories: [
          { name: "X", products: [{ name: "A", price: 1, existingProductId: "p1", onConflict: "SKIP" }] },
          { name: "Y", products: [{ name: "B", price: 2 }] },
        ],
      }),
    );
    const cleaned = result.current.cleanForCommit();
    expect(cleaned!.categories.map((c) => c.name)).toEqual(["Y"]);
  });
});

describe("MenuDraftReviewGrid", () => {
  const controls = {
    draft: {
      categories: [
        {
          name: "İçecekler",
          products: [{ name: "Ayran", price: 25, existingProductId: "p1", existingPrice: 20, onConflict: "SKIP" as const }],
        },
      ],
    },
    totalItems: 1,
    invalidRowCount: 0,
    conflictCount: 1,
    updateProduct: vi.fn(),
    updateCategoryName: vi.fn(),
    removeProduct: vi.fn(),
    removeCategory: vi.fn(),
    addProduct: vi.fn(),
    setAllConflictPolicy: vi.fn(),
  };

  it("shows the bulk conflict selector when there are conflicts", () => {
    render(<MenuDraftReviewGrid controls={controls as any} onCommit={vi.fn()} onCancel={vi.fn()} isCommitting={false} />);
    expect(screen.getByTestId("conflict-bulk")).toBeInTheDocument();
  });

  it("applies the bulk choice to every conflicting row", () => {
    render(<MenuDraftReviewGrid controls={controls as any} onCommit={vi.fn()} onCancel={vi.fn()} isCommitting={false} />);
    fireEvent.change(screen.getByTestId("conflict-bulk"), { target: { value: "UPDATE_PRICE" } });
    expect(controls.setAllConflictPolicy).toHaveBeenCalledWith("UPDATE_PRICE");
  });

  it("surfaces the existing price on a conflicting row", () => {
    render(<MenuDraftReviewGrid controls={controls as any} onCommit={vi.fn()} onCancel={vi.fn()} isCommitting={false} />);
    expect(screen.getByText(/20/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/admin/menuManagement/MenuDraftReviewGrid.test.tsx`
Expected: FAIL — modüller yok

- [ ] **Step 4: Create useMenuDraft.ts**

`MenuImportTab.tsx:64-178` içindeki memolar ve değiştiriciler buraya taşınır, üstüne çakışma alanları eklenir:

```ts
import { useMemo, useState } from "react";
import type {
  ConflictPolicy,
  MenuImportDraft,
} from "../../../features/menu/menuApi";

/**
 * Draft state for the review grid, lifted out of MenuImportTab so a link or
 * spreadsheet import can share it. Knows nothing about where the draft came
 * from — photos, a URL, or a file all produce the same shape.
 */
export function useMenuDraft() {
  const [draft, setDraft] = useState<MenuImportDraft | null>(null);

  const totalItems = useMemo(
    () => draft?.categories.reduce((n, c) => n + c.products.length, 0) ?? 0,
    [draft],
  );

  // Rows the commit endpoint would reject: blank product name or a negative
  // price, plus a blank category name over real rows.
  const invalidRowCount = useMemo(() => {
    if (!draft) return 0;
    return draft.categories.reduce((n, c) => {
      const badRows = c.products.filter((p) => !p.name.trim() || p.price < 0).length;
      const badCatName = !c.name.trim() && c.products.length > 0 ? 1 : 0;
      return n + badRows + badCatName;
    }, 0);
  }, [draft]);

  const conflictCount = useMemo(
    () =>
      draft?.categories.reduce(
        (n, c) => n + c.products.filter((p) => p.existingProductId).length,
        0,
      ) ?? 0,
    [draft],
  );

  const updateProduct = (ci: number, pi: number, patch: Record<string, unknown>) =>
    setDraft((d) =>
      d
        ? {
            categories: d.categories.map((c, i) =>
              i !== ci
                ? c
                : { ...c, products: c.products.map((p, j) => (j !== pi ? p : { ...p, ...patch })) },
            ),
          }
        : d,
    );

  const updateCategoryName = (ci: number, name: string) =>
    setDraft((d) =>
      d ? { categories: d.categories.map((c, i) => (i === ci ? { ...c, name } : c)) } : d,
    );

  const removeProduct = (ci: number, pi: number) =>
    setDraft((d) =>
      d
        ? {
            categories: d.categories.map((c, i) =>
              i !== ci ? c : { ...c, products: c.products.filter((_, j) => j !== pi) },
            ),
          }
        : d,
    );

  const removeCategory = (ci: number) =>
    setDraft((d) => (d ? { categories: d.categories.filter((_, i) => i !== ci) } : d));

  const addProduct = (ci: number) =>
    setDraft((d) =>
      d
        ? {
            categories: d.categories.map((c, i) =>
              i !== ci ? c : { ...c, products: [...c.products, { name: "", price: 0 }] },
            ),
          }
        : d,
    );

  /** Apply one choice to every row that actually collided. */
  const setAllConflictPolicy = (policy: ConflictPolicy) =>
    setDraft((d) =>
      d
        ? {
            categories: d.categories.map((c) => ({
              ...c,
              products: c.products.map((p) =>
                p.existingProductId ? { ...p, onConflict: policy } : p,
              ),
            })),
          }
        : d,
    );

  /**
   * What actually goes to the server: SKIP rows never leave the browser, and
   * a category left with nothing is dropped.
   */
  const cleanForCommit = (): MenuImportDraft | null => {
    if (!draft) return null;
    return {
      categories: draft.categories
        .map((c) => ({
          name: c.name.trim(),
          products: c.products.filter(
            (p) =>
              p.name.trim() &&
              p.price >= 0 &&
              !(p.existingProductId && (p.onConflict ?? "SKIP") === "SKIP"),
          ),
        }))
        .filter((c) => c.name && c.products.length),
    };
  };

  return {
    draft,
    setDraft,
    totalItems,
    invalidRowCount,
    conflictCount,
    updateProduct,
    updateCategoryName,
    removeProduct,
    removeCategory,
    addProduct,
    setAllConflictPolicy,
    cleanForCommit,
  };
}

export type MenuDraftControls = ReturnType<typeof useMenuDraft>;
```

- [ ] **Step 5: Create MenuDraftReviewGrid.tsx**

`MenuImportTab.tsx:317-470` JSX'i buraya taşınır. `cellCls` ve `TAX_RATES` de buraya gelir ve buradan export edilir. Çakışan satır için eklenecek olan: satırın etrafına `ring-1 ring-amber-300`, mevcut fiyatı gösteren bir etiket ve satır başına bir `<select>`; ızgaranın üstüne toplu `<select data-testid="conflict-bulk">`.

```tsx
import { useTranslation } from "react-i18next";
import { Trash2, Plus, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import type { ConflictPolicy } from "../../../features/menu/menuApi";
import type { MenuDraftControls } from "./useMenuDraft";

export const TAX_RATES = [0, 1, 10, 20];
export const cellCls =
  "w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500";

/**
 * The reviewable draft, for every source: photos, a link, a spreadsheet.
 * Purely presentational — all state lives in useMenuDraft, so a second
 * source needs no copy of this.
 */
export default function MenuDraftReviewGrid({
  controls,
  onCommit,
  onCancel,
  isCommitting,
}: {
  controls: MenuDraftControls;
  onCommit: () => void;
  onCancel: () => void;
  isCommitting: boolean;
}) {
  const { t } = useTranslation(["menu", "common"]);
  const {
    draft,
    totalItems,
    conflictCount,
    updateProduct,
    updateCategoryName,
    removeProduct,
    removeCategory,
    addProduct,
    setAllConflictPolicy,
  } = controls;

  if (!draft) return null;

  const POLICIES: { value: ConflictPolicy; label: string }[] = [
    { value: "SKIP", label: t("menu:import.conflict.skip", "Atla") as string },
    { value: "UPDATE_PRICE", label: t("menu:import.conflict.updatePrice", "Fiyatı güncelle") as string },
    { value: "CREATE", label: t("menu:import.conflict.create", "Yine de ekle") as string },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">
          {t("menu:import.reviewHint", "{{cats}} kategori · {{items}} ürün — düzenleyip onaylayın", {
            cats: draft.categories.length,
            items: totalItems,
          })}
        </div>
        <button type="button" onClick={onCancel} className="text-sm text-gray-500 underline hover:text-gray-700">
          {t("common:cancel", "İptal")}
        </button>
      </div>

      {conflictCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span>
            {t("menu:import.conflict.count", "{{n}} ürün menünüzde zaten var", { n: conflictCount })}
          </span>
          <select
            data-testid="conflict-bulk"
            className={`${cellCls} max-w-[14rem]`}
            defaultValue="SKIP"
            onChange={(e) => setAllConflictPolicy(e.target.value as ConflictPolicy)}
          >
            {POLICIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {draft.categories.map((cat, ci) => (
        <div key={ci} className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2">
            <input
              value={cat.name}
              onChange={(e) => updateCategoryName(ci, e.target.value)}
              placeholder={t("menu:import.categoryName", "Kategori adı") as string}
              className={`${cellCls} max-w-xs font-semibold ${
                !cat.name.trim() && cat.products.length > 0 ? "!border-red-500" : ""
              }`}
            />
            <button type="button" onClick={() => removeCategory(ci)} className="text-gray-400 hover:text-red-600">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-2">
            {cat.products.map((p, pi) => (
              <div
                key={pi}
                className={`grid grid-cols-12 items-center gap-2 rounded-md ${
                  p.existingProductId ? "bg-amber-50/60 ring-1 ring-amber-200" : ""
                }`}
              >
                <input
                  value={p.name}
                  onChange={(e) => updateProduct(ci, pi, { name: e.target.value })}
                  placeholder={t("menu:import.itemName", "Ürün adı") as string}
                  className={`${cellCls} col-span-3 ${!p.name.trim() ? "!border-red-500" : ""}`}
                />
                <input
                  value={p.description ?? ""}
                  onChange={(e) => updateProduct(ci, pi, { description: e.target.value })}
                  placeholder={t("menu:import.itemDesc", "Açıklama") as string}
                  className={`${cellCls} col-span-3`}
                />
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={p.price}
                  onChange={(e) => updateProduct(ci, pi, { price: Number(e.target.value) || 0 })}
                  className={`${cellCls} col-span-2 text-right ${p.price < 0 ? "!border-red-500" : ""}`}
                />
                <select
                  value={p.taxRate ?? 10}
                  onChange={(e) => updateProduct(ci, pi, { taxRate: Number(e.target.value) })}
                  className={`${cellCls} col-span-1`}
                >
                  {TAX_RATES.map((r) => (
                    <option key={r} value={r}>%{r}</option>
                  ))}
                </select>

                {p.existingProductId ? (
                  <div className="col-span-2 flex items-center gap-1">
                    <span className="whitespace-nowrap text-xs text-amber-700">
                      {t("menu:import.conflict.was", "şu an {{p}}", { p: p.existingPrice })}
                    </span>
                    <select
                      value={p.onConflict ?? "SKIP"}
                      onChange={(e) => updateProduct(ci, pi, { onConflict: e.target.value })}
                      className={`${cellCls} text-xs`}
                    >
                      {POLICIES.map((op) => (
                        <option key={op.value} value={op.value}>{op.label}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="col-span-2" />
                )}

                <button
                  type="button"
                  onClick={() => removeProduct(ci, pi)}
                  className="col-span-1 justify-self-center text-gray-400 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => addProduct(ci)}
            className="mt-3 inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700"
          >
            <Plus className="h-4 w-4" />
            {t("menu:import.addItem", "Ürün ekle")}
          </button>
        </div>
      ))}

      <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-gray-200 bg-white/90 py-3 backdrop-blur">
        <Button variant="outline" onClick={onCancel}>
          {t("common:cancel", "İptal")}
        </Button>
        <Button onClick={onCommit} disabled={isCommitting || totalItems === 0}>
          {isCommitting ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("menu:import.creating", "Oluşturuluyor…")}</>
          ) : (
            <><CheckCircle2 className="mr-2 h-4 w-4" />{t("menu:import.commit", "{{n}} ürünü oluştur", { n: totalItems })}</>
          )}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Rewrite MenuImportTab to consume both, and fix its two defects**

- Dış `export default` fonksiyonundaki `<FeatureGate>` **kaldırılır**; gate yalnız 1. adımı (foto seçimi + "Dijitalleştir" düğmesi) saracak şekilde içeri taşınır. Böylece planı düşen bir tenant elindeki taslağı görmeye ve commit etmeye devam edebilir (commit ucu zaten kapısız).
- `draft` durumu ve tüm değiştiriciler silinip `const controls = useMenuDraft()` ile değiştirilir.
- 2. adımın JSX'i `<MenuDraftReviewGrid controls={controls} … />` ile değiştirilir.
- `handleCommit`, `controls.cleanForCommit()` kullanır ve **BulkAddModal'ın başarısız-satır saklama algoritmasını** uygular:

```ts
  const handleCommit = async () => {
    if (controls.invalidRowCount > 0) {
      toast.error(
        t("menu:import.invalidRows", "{{n}} satır eksik veya hatalı (boş ad ya da negatif fiyat) — düzeltin veya silin", {
          n: controls.invalidRowCount,
        }),
      );
      return;
    }
    const cleaned = controls.cleanForCommit();
    if (!cleaned?.categories.length) {
      toast.error(t("menu:import.nothingToImport", "İçe aktarılacak ürün yok"));
      return;
    }
    try {
      const result = await commit.mutateAsync(cleaned);
      setSummary(result);
      if (result.failures.length === 0) {
        controls.setDraft(null);
        setPhotos([]);
        toast.success(t("menu:import.done", "{{count}} ürün oluşturuldu", { count: result.productsCreated }));
        return;
      }
      // Partial: keep ONLY the rows that failed so they can be fixed and
      // retried, the way BulkAddModal already does. Clearing the draft here
      // used to throw away a quota-consuming parse.
      const failedKeys = new Set(result.failures.map((f) => `${f.category}||${f.product}`));
      controls.setDraft({
        categories: cleaned.categories
          .map((c) => ({
            ...c,
            products: c.products.filter((p) => failedKeys.has(`${c.name}||${p.name.trim()}`)),
          }))
          .filter((c) => c.products.length),
      });
      toast.warning(
        t("menu:import.partial", "{{ok}} ürün eklendi, {{fail}} başarısız.", {
          ok: result.productsCreated,
          fail: result.failures.length,
        }),
      );
    } catch {
      /* toast handled in the hook */
    }
  };
```

- 3. adımdaki `summary.failures.slice(0, 8)` → `slice(0, 50)`; bir site kazımasında 8'den çok satır patlayabilir.

- [ ] **Step 7: Run the tests**

Run: `cd frontend && npx vitest run src/pages/admin/menuManagement/`
Expected: PASS — yeni 6 test ve mevcut `MenuTree.test.tsx`

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/admin/menuManagement/useMenuDraft.ts frontend/src/pages/admin/menuManagement/MenuDraftReviewGrid.tsx frontend/src/pages/admin/menuManagement/MenuDraftReviewGrid.test.tsx frontend/src/pages/admin/menuManagement/MenuImportTab.tsx frontend/src/features/menu/menuApi.ts
git commit -m "refactor(menu): inceleme ızgarasını bileşene çıkar, iki kusuru kapat

Izgara bugüne dek MenuImportTabInner içinde kapanış hâlindeydi; ikinci bir
kaynak onu kullanamıyordu. useMenuDraft + MenuDraftReviewGrid olarak ayrıldı
ve çakışma seçimi (toplu + satır bazında) eklendi.

Aynı turda: FeatureGate tüm akışı sarıyordu, artık yalnız parse adımını
sarıyor — planı düşen tenant elindeki taslağı görebilsin, commit ucu zaten
kapısız. Ve commit'te başarısız satırlar atılıyordu; BulkAddModal'ın
saklama algoritması taşındı, hata listesi tavanı 8'den 50'ye çıktı."
```

---

## Task 10: Kaynak sekmesi ve üç seçenekli düğme

**Files:**
- Create: `frontend/src/pages/admin/menuManagement/MenuSourceTab.tsx`
- Modify: `frontend/src/features/menu/menuApi.ts` (`useParseMenuSource`)
- Modify: `frontend/src/pages/admin/MenuManagementPage.tsx`
- Test: `frontend/src/pages/admin/menuManagement/MenuSourceTab.test.tsx`

**Interfaces:**
- Consumes: `useMenuDraft`, `MenuDraftReviewGrid`, `useCommitMenuImport`
- Produces: `useParseMenuSource()` — `{ url?: string; file?: File }` alır, `MenuImportDraft` döner.

- [ ] **Step 1: Add the hook**

`menuApi.ts`, `useParseMenuPhotos`'un altına:

```ts
/** Import a menu from a link or an uploaded PDF/CSV/XLSX → editable draft. */
export const useParseMenuSource = () =>
  useMutation({
    mutationFn: async (input: { url?: string; file?: File }) => {
      const formData = new FormData();
      if (input.url) formData.append("url", input.url);
      if (input.file) formData.append("file", input.file);
      const response = await api.post<MenuImportDraft>(
        "/menu/import/parse-source",
        formData,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      return response.data;
    },
    onError: (error: any) => {
      toast.error(
        getApiErrorMessage(error, i18n.t("common:notifications.operationFailed")),
      );
    },
  });
```

- [ ] **Step 2: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MenuSourceTab from "./MenuSourceTab";

const parseMutate = vi.fn();
vi.mock("../../../features/menu/menuApi", () => ({
  useParseMenuSource: () => ({ mutateAsync: parseMutate, isPending: false }),
  useCommitMenuImport: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, d?: any) => (typeof d === "string" ? d : d?.defaultValue ?? k) }),
}));

describe("MenuSourceTab", () => {
  it("refuses to submit an empty link", () => {
    render(<MenuSourceTab />);
    fireEvent.click(screen.getByTestId("source-submit"));
    expect(parseMutate).not.toHaveBeenCalled();
  });

  it("sends the pasted link", async () => {
    parseMutate.mockResolvedValue({ categories: [] });
    render(<MenuSourceTab />);
    fireEvent.change(screen.getByTestId("source-url"), {
      target: { value: "https://restoran.com/menu" },
    });
    fireEvent.click(screen.getByTestId("source-submit"));
    expect(parseMutate).toHaveBeenCalledWith({ url: "https://restoran.com/menu", file: undefined });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/admin/menuManagement/MenuSourceTab.test.tsx`
Expected: FAIL — modül yok

- [ ] **Step 4: Create MenuSourceTab.tsx**

Yapı `MenuImportTab` ile aynı üç adımlı akışı izler; tek fark 1. adımın girişi.

```tsx
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Link2, Upload, Loader2, Sparkles, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import FeatureGate from "../../../components/subscriptions/FeatureGate";
import {
  useParseMenuSource,
  useCommitMenuImport,
  type MenuImportCommitSummary,
} from "../../../features/menu/menuApi";
import { useMenuDraft } from "./useMenuDraft";
import MenuDraftReviewGrid from "./MenuDraftReviewGrid";

const ACCEPT = ".pdf,.csv,.tsv,.xlsx,.xls,application/pdf,text/csv";

/**
 * "Kaynak ver": paste a link or drop a file, and every product behind it
 * lands in the same review grid the photo importer uses.
 */
export default function MenuSourceTab({
  onDirtyChange,
}: {
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation(["menu", "common"]);
  const parse = useParseMenuSource();
  const commit = useCommitMenuImport();
  const controls = useMenuDraft();

  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<MenuImportCommitSummary | null>(null);

  const dirty = !!controls.draft || parse.isPending;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const handleParse = async () => {
    if (!url.trim() && !file) return;
    setSummary(null);
    try {
      controls.setDraft(await parse.mutateAsync({ url: url.trim() || undefined, file: file ?? undefined }));
    } catch {
      /* toast handled in the hook */
    }
  };

  const reset = () => {
    controls.setDraft(null);
    setUrl("");
    setFile(null);
    setSummary(null);
  };

  const handleCommit = async () => {
    if (controls.invalidRowCount > 0) {
      toast.error(
        t("menu:import.invalidRows", "{{n}} satır eksik veya hatalı (boş ad ya da negatif fiyat) — düzeltin veya silin", {
          n: controls.invalidRowCount,
        }),
      );
      return;
    }
    const cleaned = controls.cleanForCommit();
    if (!cleaned?.categories.length) {
      toast.error(t("menu:import.nothingToImport", "İçe aktarılacak ürün yok"));
      return;
    }
    try {
      const result = await commit.mutateAsync(cleaned);
      setSummary(result);
      if (result.failures.length === 0) {
        reset();
        setSummary(result);
        toast.success(t("menu:import.done", "{{count}} ürün oluşturuldu", { count: result.productsCreated }));
        return;
      }
      const failedKeys = new Set(result.failures.map((f) => `${f.category}||${f.product}`));
      controls.setDraft({
        categories: cleaned.categories
          .map((c) => ({ ...c, products: c.products.filter((p) => failedKeys.has(`${c.name}||${p.name.trim()}`)) }))
          .filter((c) => c.products.length),
      });
      toast.warning(
        t("menu:import.partial", "{{ok}} ürün eklendi, {{fail}} başarısız.", {
          ok: result.productsCreated,
          fail: result.failures.length,
        }),
      );
    } catch {
      /* toast handled in the hook */
    }
  };

  return (
    <div className="space-y-6">
      {!controls.draft && (
        <FeatureGate feature="aiContentGeneration" showUpgradePrompt>
          <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-5">
            <p className="text-sm text-gray-600">
              {t(
                "menu:source.hint",
                "Menünüzün bulunduğu sayfanın adresini yapıştırın ya da PDF / Excel / CSV dosyanızı yükleyin. Tüm ürünler çıkarılıp önünüze gelir.",
              )}
            </p>

            <div className="flex items-center gap-2">
              <Link2 className="h-4 w-4 shrink-0 text-gray-400" />
              <input
                data-testid="source-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://restoran.com/menu"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <Upload className="h-4 w-4 shrink-0 text-gray-400" />
              <input
                data-testid="source-file"
                type="file"
                accept={ACCEPT}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="text-sm"
              />
            </div>

            <Button
              data-testid="source-submit"
              onClick={handleParse}
              disabled={parse.isPending || (!url.trim() && !file)}
            >
              {parse.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("menu:source.reading", "Okunuyor…")}</>
              ) : (
                <><Sparkles className="mr-2 h-4 w-4" />{t("menu:source.parse", "Ürünleri çıkar")}</>
              )}
            </Button>
          </div>
        </FeatureGate>
      )}

      <MenuDraftReviewGrid
        controls={controls}
        onCommit={handleCommit}
        onCancel={reset}
        isCommitting={commit.isPending}
      />

      {summary && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-5">
          <div className="mb-2 flex items-center gap-2 font-semibold text-green-800">
            <CheckCircle2 className="h-5 w-5" />
            {t("menu:import.summaryTitle", "İçe aktarma tamamlandı")}
          </div>
          <p className="text-sm text-green-700">
            {t("menu:source.summary", "{{p}} yeni · {{u}} güncellendi · {{s}} atlandı", {
              p: summary.productsCreated,
              u: summary.productsUpdated,
              s: summary.productsSkipped,
            })}
          </p>
          {summary.failures.length > 0 && (
            <div className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
              <div className="mb-1 flex items-center gap-1 font-medium">
                <AlertTriangle className="h-4 w-4" />
                {t("menu:import.someFailed", "{{n}} ürün oluşturulamadı", { n: summary.failures.length })}
              </div>
              <ul className="list-inside list-disc">
                {summary.failures.slice(0, 50).map((f, i) => (
                  <li key={i}>{f.category} › {f.product}: {f.reason}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-4">
            <Button variant="outline" onClick={reset}>
              {t("menu:import.importMore", "Yeni menü ekle")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Replace the two toolbar buttons with one dropdown**

`MenuManagementPage.tsx` — `bulkAddOpen` / `importModalOpen` yerine tek durum:

```tsx
  type ImportMode = "source" | "photo" | "manual" | null;
  const [importMode, setImportMode] = useState<ImportMode>(null);
```

Araç çubuğundaki iki `Button` (`MenuManagementPage.tsx:329-343`) şununla değiştirilir:

```tsx
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={!canAddProduct}>
                <ListPlus className="mr-1.5 h-4 w-4" />
                {t("menu.bulkAdd", "Toplu ekle")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {menuImportStatus?.configured !== false && (
                <DropdownMenuItem onClick={() => setImportMode("source")}>
                  <Link2 className="mr-2 h-4 w-4" />
                  {t("menu.importFromSource", "Kaynak ver (link / PDF / Excel)")}
                </DropdownMenuItem>
              )}
              {menuImportStatus?.configured !== false && (
                <DropdownMenuItem onClick={() => setImportMode("photo")}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  {t("menu.importAction", "Fotoğraftan al")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setImportMode("manual")}>
                <ListPlus className="mr-2 h-4 w-4" />
                {t("menu.bulkAddManual", "Manuel toplu ekle")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
```

Ve tek modal barındırıcı, üç modun hepsini `importDirty` koruması altına alır:

```tsx
      <Modal
        isOpen={importMode !== null}
        onClose={handleCloseImportModal}
        title={
          importMode === "source"
            ? t("menu.importFromSource", "Kaynak ver (link / PDF / Excel)")
            : importMode === "photo"
              ? t("menu.importAction", "Fotoğraftan al")
              : t("menu.bulkAddManual", "Manuel toplu ekle")
        }
        size="full"
      >
        {importMode === "source" && <MenuSourceTab onDirtyChange={setImportDirty} />}
        {importMode === "photo" && <MenuImportTab onDirtyChange={setImportDirty} />}
        {importMode === "manual" && (
          <BulkAddModalBody onDone={() => setImportMode(null)} onDirtyChange={setImportDirty} />
        )}
      </Modal>
```

`BulkAddModal` bugün kendi `<Modal>`'ını içeriyor (`BulkAddModal.tsx:155-160`). Gövdesi `BulkAddModalBody` olarak dışarı alınır ve `BulkAddModal` ince bir sarmalayıcı olarak kalır (başka çağıran varsa kırılmasın diye), ama bu sayfa gövdeyi doğrudan kullanır — yalnız sayfa-sahipli modal `importDirty` koruyucusunu taşıyabiliyor.

`handleCloseImportModal` `setImportModalOpen(false)` yerine `setImportMode(null)` yapacak şekilde güncellenir.

- [ ] **Step 6: Add the i18n keys to all five locales**

`menu.json` dosyalarına (`tr`, `en`, `ru`, `uz`, `ar`) ekle:

```
menu.importFromSource, menu.bulkAddManual,
source.hint, source.parse, source.reading, source.summary,
import.conflict.count, import.conflict.skip, import.conflict.updatePrice,
import.conflict.create, import.conflict.was, import.partial
```

Türkçe değerler yukarıdaki `defaultValue`'lardan alınır; diğer dörde çevrilir. CI'daki locale-parity kontrolü eksik anahtarda düşer.

- [ ] **Step 7: Run the tests and typecheck**

Run: `cd frontend && npx vitest run && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc çıkış 0

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/admin/menuManagement/MenuSourceTab.tsx frontend/src/pages/admin/menuManagement/MenuSourceTab.test.tsx frontend/src/pages/admin/MenuManagementPage.tsx frontend/src/features/menu/menuApi.ts frontend/src/components/product/BulkAddModal.tsx frontend/src/i18n/locales
git commit -m "feat(menu): tek Toplu ekle düğmesi, üç yol

Araç çubuğundaki iki ayrı düğme tek açılır menüde birleşti: kaynak ver
(link / PDF / Excel), fotoğraftan al, manuel toplu ekle. Üçü de aynı
modalda aynı inceleme ızgarasını açıyor ve üçü birden importDirty
koruması altında — kapanışta harcanmış bir parse'ı sessizce çöpe atmasın."
```

---

## Task 11: Uçtan uca doğrulama

**Files:**
- Test: elle, çalışan uygulamada

- [ ] **Step 1: Start the stack**

```bash
cd backend && PORT=3000 npm run start:dev
cd frontend && npm run dev
```

- [ ] **Step 2: Verify each source type**

`/admin/menu` → **Toplu ekle** → **Kaynak ver**:

| Girdi | Beklenen |
|---|---|
| Statik bir restoran menü sayfası linki | Kategoriler ve ürünler ızgarada, fiyatlar sayı |
| Google Sheets paylaşım linki (herkese açık) | AI çağrısı yok, satırlar birebir |
| Google Sheets linki (paylaşım kapalı) | "herkese açık değil" hatası, 200'e rağmen |
| `.xlsx` yükleme | İlk sayfa okunur, sütunlar eşlenir |
| `.pdf` yükleme | Sayfalar okunur |
| `http://169.254.169.254/latest/meta-data/` | 400 "URL resolves to a private address" |
| `http://localhost:5432` | 400 (port engelli) |

- [ ] **Step 3: Verify the conflict flow**

Zaten var olan bir ürünü içeren bir kaynak ver → çakışan satır sarı, mevcut fiyat görünür, üstteki toplu seçim üçünü de değiştiriyor → **Fiyatı güncelle** ile commit → ürünün yalnız fiyatı değişmiş, açıklaması/fotoğrafı duruyor.

- [ ] **Step 4: Verify the quota refund**

`ANTHROPIC_API_KEY`'i geçersiz bir değere çevir → link ver → hata alınır ve kontör bakiyesi düşmemiş olur.

- [ ] **Step 5: Commit nothing — this task only records the result**

Bulunan her kusur için önceki ilgili göreve dön, testi ekle, düzelt.

---

## Self-Review

**Spec coverage**

| Spec bölümü | Görev |
|---|---|
| İçerik tipi tespiti (baytlar > başlık > uzantı) | Task 2 |
| İki fazlı SSRF, yönlendirme yeniden doğrulama, 10MB/15s/3 | Task 3 |
| Sheets normalize + kapalı-paylaşım tespiti | Task 3 |
| Parçalama (24k, 15 satır örtüşme, 6 tavan) + birleştirme | Task 4 |
| CSV formül-kaçış tersine çevirme, TR/EN ondalık | Task 5 |
| Sütun eşleyici, tanınmazsa tek küçük model çağrısı | Task 5, Task 6 |
| PDF → Claude document bloğu, yeni bağımlılık yok | Task 6 |
| HTML → metin | Task 6 |
| `askClaude` ortaklaştırma | Task 1 |
| Kontör: parça başına iade | Task 6 |
| Çakışma: işaretleme + üç dal + tenant doğrulama | Task 7 |
| `POST parse-source` | Task 8 |
| Izgara çıkarma, FeatureGate daraltma, başarısız-satır saklama | Task 9 |
| Üç seçenekli düğme, tek modal, dirty guard | Task 10 |
| XLSX paket seçimi | Task 6 Step 1 — `exceljs` |

Boşluk yok.

**Placeholder scan:** "TBD"/"TODO"/"benzer şekilde" yok; her kod adımı gerçek kod içeriyor.

**Type consistency:** `ConflictPolicy` hem `menuApi.ts` (Task 9) hem DTO (Task 7) tarafında aynı üç değer. `MenuDraftControls` Task 9'da üretilir, Task 10'da tüketilir. `parseTextToDraft` / `parseDocumentToDraft` / `parseColumnMap` Task 6'da tanımlanır ve yalnız orada çağrılır. `FetchedSource` Task 3'te üretilir, Task 6'da tüketilir. `SourceKind` Task 2 → Task 6.
