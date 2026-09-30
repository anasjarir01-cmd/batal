// يولّد نسخ عرض WebP مصغّرة ومطابقة بصريًا لكل صورة أصلية، ويكتب فهرس الأصول الذي يستعمله التطبيق
// لتنزيل الأصول للعمل دون إنترنت. الصور الأصلية PNG لا تُعدّل أبدًا.
// التشغيل: npm run assets:prepare
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(root, 'asset-sources/asset-manifest.json'), 'utf8'));

const CARD_WIDTH = 600; // بطاقات القدرات بنسبة 2:3
const PORTRAIT_WIDTH = 720; // صور الشخصيات بنسبة 9:16 تقريبًا

const index = [];
for (const entry of manifest.files) {
  const src = join(root, 'public', entry.path);
  const data = await readFile(src);
  const sha = createHash('sha256').update(data).digest('hex');
  if (sha !== entry.sha256 || data.length !== entry.bytes) {
    throw new Error(`بصمة غير مطابقة: ${entry.path}`);
  }
  const isCard = /-[A-Z]\d\.png$/.test(entry.path);
  const displayRel = entry.path.replace(/^assets\//, 'assets-display/').replace(/\.png$/, '.webp');
  const displayAbs = join(root, 'public', displayRel);
  await mkdir(dirname(displayAbs), { recursive: true });
  const img = sharp(data);
  const meta = await img.metadata();
  const width = Math.min(meta.width ?? 0, isCard ? CARD_WIDTH : PORTRAIT_WIDTH);
  await img.resize({ width }).webp({ quality: isCard ? 90 : 86, effort: 5 }).toFile(displayAbs);
  const dStat = await stat(displayAbs);
  const dMeta = await sharp(displayAbs).metadata();
  index.push({
    original: entry.path,
    display: displayRel,
    originalBytes: entry.bytes,
    displayBytes: dStat.size,
    sha256: entry.sha256,
    width: meta.width,
    height: meta.height,
    displayWidth: dMeta.width,
    displayHeight: dMeta.height,
  });
  process.stdout.write('.');
}
index.sort((a, b) => a.original.localeCompare(b.original));
await writeFile(join(root, 'src/catalog/assetIndex.generated.json'), JSON.stringify(index, null, 2) + '\n');
const total = index.reduce((s, e) => s + e.originalBytes + e.displayBytes, 0);
console.log(`\n${index.length} أصلًا، الحجم الكلي ${(total / 1e6).toFixed(1)} MB`);
