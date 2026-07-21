// Generate the system-wide pixel-art floor-plan sprite set via the fal.ai
// queue API. Pipeline per object per candidate:
//   1. fal-ai/recraft/v3/text-to-image  (pixel-art style, shared palette + prompt skeleton)
//   2. fal-ai/birefnet/v2               (background removal → transparent PNG)
//   3. fal-ai/image2pixel               (palette snap + grid snap + trim)
// Candidates land in a scratch dir for human curation; a curated file is
// promoted with --pick into frontend/public/floor-sprites/v1/<key>.png.
// Filenames there are IMMUTABLE (nginx 1y immutable cache) — content changes
// bump the version dir, then flip the entry in src/features/floor-plan/sprites.ts.
//
// Usage (repo root, Node 18+, no dependencies — global fetch only):
//   FAL_KEY=... node scripts/generate-floor-sprites.mjs \
//       [--objects=plant,bar] [--candidates=2] \
//       [--scratch=scripts/.floor-sprites-scratch] [--out=frontend/public/floor-sprites/v1]
//   node scripts/generate-floor-sprites.mjs --pick plant=scripts/.floor-sprites-scratch/plant-cand1.png
//
// Cost: ~$0.04 per Recraft image (bg-removal + pixelation are much cheaper).
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ALL_KEYS = [
  'table-round',
  'table-square',
  'table-rect',
  'plant',
  'bar',
  'kitchen',
  'door',
  'decor',
];

// Written for a strict flat-lay read: describe the visible TOP SURFACE, not
// the object — that is what keeps Recraft from drifting into 3/4 scene shots.
const OBJECT_DESCRIPTIONS = {
  'table-round': 'round wooden restaurant table with plates of food on it',
  'table-square':
    'square wooden restaurant table with plates of food set on it, no chairs around it',
  'table-rect':
    'long rectangular wooden restaurant table with plates of food set on it, no chairs around it',
  plant: 'leafy potted plant',
  bar: 'long wooden bar countertop seen looking straight down at it: an elongated flat wooden slab with glasses and bottles standing on top, strictly overhead view',
  kitchen:
    'rectangular commercial kitchen countertop with a built-in stove and pans, a flat stainless surface',
  door: 'architectural floor-plan door symbol: a straight wooden door leaf with a quarter-circle swing arc',
  decor: 'flat rectangular ornamental area rug with a simple geometric pattern',
};

// One shared skeleton so all 8 objects read as one asset set. Pure white
// backdrop (cleanest birefnet cutouts), a single explicit camera angle, and
// "nothing else in frame" — stray props/walls read as part of the sprite.
const promptFor = (key) =>
  `2D pixel art sprite of a single ${OBJECT_DESCRIPTIONS[key]}, flat lay viewed from ` +
  "directly above (orthographic top-down bird's-eye view, like furniture on a " +
  'video game floor plan, no perspective), clean retro game asset, one object ' +
  'only, centered, the whole object fits inside the frame with empty margin ' +
  'on all sides, not cropped, nothing else in frame, no floor, no wall, no ' +
  'shadow, no text, isolated on a pure white background, crisp clean pixels';

// One warm shared palette. Deliberately NO greys (they get snapped onto
// leftover backdrop/halo pixels) and a dark brown outline tone instead.
const SHARED_PALETTE_HEX = [
  '#3A2E27',
  '#8B5A2B',
  '#A9745B',
  '#C89F6B',
  '#F2E8DA',
  '#4C9A4C',
  '#2F6B3A',
  '#C94F4F',
];
const hexToRgb = (hex) => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
});
const SHARED_PALETTE_RGB = SHARED_PALETTE_HEX.map(hexToRgb);

// Sprites are authored at each type's default footprint aspect so default
// placements are undistorted (bar 220×60 ≈ 11:3, kitchen 200×140 = 10:7).
const IMAGE_SIZE = {
  bar: { width: 1024, height: 288 },
  kitchen: { width: 1024, height: 717 },
};
const DEFAULT_IMAGE_SIZE = { width: 1024, height: 1024 };
// Nearest Recraft preset, used once if the exact size gets a 4xx.
const PRESET_FALLBACK = { bar: 'landscape_4_3', kitchen: 'landscape_4_3' };
const DEFAULT_PRESET = 'square_hd';

const JOB_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 1500;
const COST_PER_RECRAFT_IMAGE = 0.04;

// ---------------------------------------------------------------- CLI parsing

function parseCli(argv) {
  const opts = {
    objects: ALL_KEYS,
    candidates: 2,
    scratch: 'scripts/.floor-sprites-scratch',
    out: 'frontend/public/floor-sprites/v1',
    picks: [],
    pixelSnap: false,
    engine: 'recraft',
    seedBase: 42,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eat = (name) => (arg.startsWith(`${name}=`) ? arg.slice(name.length + 1) : argv[++i]);
    if (arg === '--pixel-snap') {
      opts.pixelSnap = true;
    } else if (arg.startsWith('--seed-base')) {
      opts.seedBase = Number(eat('--seed-base'));
    } else if (arg.startsWith('--engine')) {
      opts.engine = eat('--engine');
      if (!['recraft', 'flux'].includes(opts.engine)) {
        console.error(`--engine must be recraft|flux, got: ${opts.engine}`);
        process.exit(1);
      }
    } else if (arg.startsWith('--objects')) {
      opts.objects = eat('--objects').split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg.startsWith('--candidates')) {
      opts.candidates = Number(eat('--candidates'));
    } else if (arg.startsWith('--scratch')) {
      opts.scratch = eat('--scratch');
    } else if (arg.startsWith('--out')) {
      opts.out = eat('--out');
    } else if (arg.startsWith('--pick')) {
      const spec = eat('--pick');
      const idx = spec?.indexOf('=') ?? -1;
      if (idx < 1) {
        console.error(`--pick expects key=candidateFile, got: ${spec}`);
        process.exit(1);
      }
      opts.picks.push({ key: spec.slice(0, idx), file: spec.slice(idx + 1) });
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  const badKeys = opts.objects.filter((k) => !ALL_KEYS.includes(k));
  if (badKeys.length) {
    console.error(`Unknown object key(s): ${badKeys.join(', ')}\nValid keys: ${ALL_KEYS.join(', ')}`);
    process.exit(1);
  }
  if (!Number.isInteger(opts.candidates) || opts.candidates < 1) {
    console.error(`--candidates must be a positive integer, got: ${opts.candidates}`);
    process.exit(1);
  }
  return opts;
}

const opts = parseCli(process.argv.slice(2));
const scratchDir = path.resolve(repoRoot, opts.scratch);
const outDir = path.resolve(repoRoot, opts.out);

// ------------------------------------------------------------------ pick mode

if (opts.picks.length) {
  // Post-process on promote when sharp is available (installed under
  // frontend/node_modules): hard alpha threshold (kills cutout halo smears),
  // trim transparent borders, nearest-neighbor downscale into a 256px box so
  // the shipped asset is small and stays crisp. Falls back to a plain copy.
  let sharp = null;
  try {
    const { createRequire } = await import('module');
    sharp = createRequire(path.join(repoRoot, 'frontend', 'package.json'))('sharp');
  } catch {
    console.warn('sharp not available — promoting candidates without trim/resize');
  }
  const promote = async (src, dest) => {
    if (!sharp) return copyFile(src, dest);
    const { data, info } = await sharp(src)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let i = 3; i < data.length; i += 4) data[i] = data[i] < 140 ? 0 : 255;
    await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .resize(256, 256, { fit: 'inside', kernel: 'nearest', withoutEnlargement: true })
      .png({ compressionLevel: 9, palette: true })
      .toFile(dest);
  };
  await mkdir(outDir, { recursive: true });
  for (const { key, file } of opts.picks) {
    if (!ALL_KEYS.includes(key)) {
      console.error(`--pick: unknown key "${key}". Valid keys: ${ALL_KEYS.join(', ')}`);
      process.exit(1);
    }
    const src = path.resolve(repoRoot, file);
    if (!existsSync(src)) {
      console.error(`--pick: candidate file not found: ${src}`);
      process.exit(1);
    }
    await promote(src, path.join(outDir, `${key}.png`));
    console.log(`✓ promoted ${key} ← ${file}`);
  }
  console.log(
    '\nNow flip the promoted entries in frontend/src/features/floor-plan/sprites.ts ' +
      "to `${SPRITE_BASE}/<key>.png` (sprites.test.ts guards existence).",
  );
  process.exit(0);
}

// ------------------------------------------------------------- generation mode

const FAL_KEY = process.env.FAL_KEY;
if (!FAL_KEY) {
  console.error(
    'FAL_KEY env var is required to generate sprites (fal.ai API key, https://fal.ai/dashboard/keys).\n' +
      'Curation with --pick works without it.',
  );
  process.exit(1);
}

class FalHttpError extends Error {
  constructor(status, body, modelId) {
    // Response bodies never echo credentials; safe to surface (truncated).
    super(`fal ${modelId} returned HTTP ${status}: ${String(body).slice(0, 300)}`);
    this.status = status;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const authHeaders = { Authorization: `Key ${FAL_KEY}` };

/** Submit to the fal queue API and poll until COMPLETED; returns the response JSON. */
async function submitAndWait(modelId, body, timeoutMs = JOB_TIMEOUT_MS) {
  const submit = await fetch(`https://queue.fal.run/${modelId}`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!submit.ok) throw new FalHttpError(submit.status, await submit.text(), modelId);
  const { status_url: statusUrl, response_url: responseUrl } = await submit.json();
  if (!statusUrl || !responseUrl) throw new Error(`fal ${modelId}: queue response missing status/response url`);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const statusRes = await fetch(statusUrl, { headers: authHeaders, signal: AbortSignal.timeout(15_000) });
    if (!statusRes.ok) throw new Error(`fal ${modelId}: status poll failed with HTTP ${statusRes.status}`);
    const status = await statusRes.json();
    if (status.status === 'COMPLETED') {
      const res = await fetch(responseUrl, { headers: authHeaders, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new FalHttpError(res.status, await res.text(), modelId);
      return res.json();
    }
    if (status.status === 'FAILED' || status.status === 'ERROR') {
      throw new Error(`fal ${modelId}: job failed: ${JSON.stringify(status).slice(0, 300)}`);
    }
  }
  throw new Error(`fal ${modelId}: job timed out after ${Math.round(timeoutMs / 1000)}s`);
}

function firstImageUrl(result, modelId) {
  const url = result?.images?.[0]?.url ?? result?.image?.url;
  if (!url) throw new Error(`fal ${modelId}: no image url in response: ${JSON.stringify(result).slice(0, 300)}`);
  return url;
}

/** PNG IHDR: big-endian u32 width/height at byte offsets 16/20. */
function pngDims(buf) {
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// Billed Recraft generations — counted the moment the generation SUCCEEDS,
// not when the whole pipeline does: a later-stage failure (bg removal,
// pixelation, download) does not refund the already-billed image.
let recraftImages = 0;

async function generateCandidate(key, candidate) {
  const prompt = promptFor(key);
  const tag = `${key} cand${candidate}`;

  let recraft;
  if (opts.engine === 'flux') {
    // FLUX + pixel-art LoRA: stronger prompt adherence (top-down actually
    // lands) and reproducible seeds; ~$0.035/MP.
    console.log(`  [1/${opts.pixelSnap ? 3 : 2}] ${tag}: flux-lora text-to-image (seed ${opts.seedBase + candidate})…`);
    recraft = await submitAndWait('fal-ai/flux-lora', {
      prompt: `modern pixel art, ${prompt}`,
      loras: [
        {
          path: 'https://huggingface.co/UmeAiRT/FLUX.1-dev-LoRA-Modern_Pixel_art/resolve/main/ume_modern_pixelart.safetensors',
          scale: 1.0,
        },
      ],
      image_size: IMAGE_SIZE[key] ?? DEFAULT_IMAGE_SIZE,
      seed: opts.seedBase + candidate,
      output_format: 'png',
    });
    recraftImages++;
  } else {
    console.log(`  [1/${opts.pixelSnap ? 3 : 2}] ${tag}: recraft text-to-image…`);
    const recraftBody = {
      prompt,
      style: 'digital_illustration/pixel_art',
      image_size: IMAGE_SIZE[key] ?? DEFAULT_IMAGE_SIZE,
      colors: SHARED_PALETTE_RGB,
    };
    try {
      recraft = await submitAndWait('fal-ai/recraft/v3/text-to-image', recraftBody);
    } catch (err) {
      if (err instanceof FalHttpError && err.status >= 400 && err.status < 500) {
        const preset = PRESET_FALLBACK[key] ?? DEFAULT_PRESET;
        console.warn(`  [1/3] ${tag}: exact size rejected (HTTP ${err.status}); retrying with preset ${preset}`);
        recraft = await submitAndWait('fal-ai/recraft/v3/text-to-image', { ...recraftBody, image_size: preset });
      } else {
        throw err;
      }
    }
    recraftImages++;
  }
  const rawUrl = firstImageUrl(recraft, opts.engine === 'flux' ? 'flux-lora' : 'recraft/v3');

  // Final stage returns the image as a data URI in the response body
  // (sync_mode): fal's result CDN (v3.fal.media) is blocked by some corporate
  // networks, while queue.fal.run is reachable. Intermediate stage URLs are
  // fine — fal fetches those server-side.
  console.log(`  [2/${opts.pixelSnap ? 3 : 2}] ${tag}: birefnet background removal…`);
  const cutout = await submitAndWait('fal-ai/birefnet/v2', {
    image_url: rawUrl,
    model: 'General Use (Heavy)',
    output_format: 'png',
    refine_foreground: true,
    sync_mode: !opts.pixelSnap,
  });
  let finalUrl = firstImageUrl(cutout, 'birefnet/v2');

  if (opts.pixelSnap) {
    // Optional re-pixelization pass. Recraft's pixel_art output is already
    // pixel art, and this pass coarsens it — off by default, kept for when a
    // hard palette/grid normalization is wanted despite the detail loss.
    console.log(`  [3/3] ${tag}: image2pixel palette snap…`);
    const pixel = await submitAndWait('fal-ai/image2pixel', {
      image_url: finalUrl,
      fixed_palette: SHARED_PALETTE_HEX,
      snap_grid: true,
      transparent_background: true,
      trim_borders: true,
      sync_mode: true,
    });
    finalUrl = firstImageUrl(pixel, 'image2pixel');
  }

  let buf;
  if (finalUrl.startsWith('data:')) {
    const base64 = finalUrl.slice(finalUrl.indexOf(',') + 1);
    buf = Buffer.from(base64, 'base64');
  } else {
    const download = await fetch(finalUrl, { signal: AbortSignal.timeout(60_000) });
    if (!download.ok) throw new Error(`download failed with HTTP ${download.status}`);
    buf = Buffer.from(await download.arrayBuffer());
  }
  const dest = path.join(scratchDir, `${key}-cand${candidate}.png`);
  await writeFile(dest, buf);
  console.log(`  ✓ ${tag} → ${path.relative(repoRoot, dest)} (${buf.length} bytes)`);
  return { bytes: buf.length, dims: pngDims(buf) };
}

await mkdir(scratchDir, { recursive: true });
console.log(
  `Generating ${opts.candidates} candidate(s) × ${opts.objects.length} object(s) → ${path.relative(repoRoot, scratchDir)}\n`,
);

const rows = [];
for (const key of opts.objects) {
  console.log(`▸ ${key}`);
  for (let n = 1; n <= opts.candidates; n++) {
    try {
      const { bytes, dims } = await generateCandidate(key, n);
      rows.push({
        key,
        candidate: n,
        file: `${key}-cand${n}.png`,
        bytes,
        dims: dims ? `${dims.w}×${dims.h}` : '?',
      });
    } catch (err) {
      console.error(`  ✗ ${key} cand${n}: ${err.message}`);
      rows.push({ key, candidate: n, file: '—', bytes: 0, dims: `FAILED: ${err.message.slice(0, 60)}` });
    }
  }
}

console.log('');
console.table(rows);
console.log(
  `Estimated cost: ${recraftImages} Recraft image(s) × ~$${COST_PER_RECRAFT_IMAGE.toFixed(2)} ≈ ` +
    `$${(recraftImages * COST_PER_RECRAFT_IMAGE).toFixed(2)} (+ minor bg-removal/pixelation fees)`,
);
console.log(
  '\nCurate the candidates, then promote each winner:\n' +
    `  node scripts/generate-floor-sprites.mjs --pick <key>=${path.relative(repoRoot, scratchDir)}/<key>-cand<N>.png`,
);
if (rows.some((r) => r.file === '—')) process.exitCode = 1;
