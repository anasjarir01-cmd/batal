// يتحقق قبل البناء من وجود الصور الأصلية الـ65 ومطابقة بصمات SHA-256 ووجود نسخ العرض.
import { createHash } from 'node:crypto';
import { readFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(root, 'asset-sources/asset-manifest.json'), 'utf8'));
const index = JSON.parse(await readFile(join(root, 'src/catalog/assetIndex.generated.json'), 'utf8'));

const problems = [];
if (manifest.files.length !== 65) problems.push(`المتوقع 65 صورة في الـmanifest، الموجود ${manifest.files.length}`);
for (const entry of manifest.files) {
  try {
    const data = await readFile(join(root, 'public', entry.path));
    const sha = createHash('sha256').update(data).digest('hex');
    if (sha !== entry.sha256) problems.push(`بصمة مختلفة: ${entry.path}`);
  } catch {
    problems.push(`ملف مفقود: ${entry.path}`);
  }
  const idx = index.find((e) => e.original === entry.path);
  if (!idx) problems.push(`غير موجود في فهرس الأصول: ${entry.path}`);
  else {
    try {
      await access(join(root, 'public', idx.display));
    } catch {
      problems.push(`نسخة العرض مفقودة: ${idx.display} (شغّل npm run assets:prepare)`);
    }
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`الأصول سليمة: ${manifest.files.length} صورة أصلية مطابقة + نسخ العرض.`);
