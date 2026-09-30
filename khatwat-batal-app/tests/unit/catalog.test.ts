import { describe, expect, it } from 'vitest';
import { ASSETS, CATALOG } from '../../src/catalog';
import manifest from '../../asset-sources/asset-manifest.json';

describe('الكتالوج والأصول', () => {
  it('65 صورة: 25 للأبطال + 2 للزعماء + 38 بطاقة، كلها في فهرس الأصول ومطابقة للـmanifest', () => {
    expect(ASSETS.length).toBe(65);
    expect(manifest.files.length).toBe(65);
    const indexed = new Set(ASSETS.map((a) => a.original));
    for (const f of manifest.files) expect(indexed.has(f.path)).toBe(true);
    const heroImgs = CATALOG.heroes.flatMap((h) => h.levelImages);
    const bossImgs = CATALOG.bosses.map((b) => b.image);
    const abilityImgs = [...CATALOG.abilities.values()].map((a) => a.image);
    expect(heroImgs.length).toBe(25);
    expect(bossImgs.length).toBe(2);
    expect(abilityImgs.length).toBe(38);
    const all = new Set([...heroImgs, ...bossImgs, ...abilityImgs]);
    expect(all.size).toBe(65);
    for (const p of all) expect(indexed.has(p)).toBe(true);
    expect(CATALOG.problems).toEqual([]);
  });

  it('كل قدرة مربوطة بملفها الفردي الصحيح (ID ↔ اسم الملف)', () => {
    for (const a of CATALOG.abilities.values()) {
      expect(a.image.endsWith(`/${a.ownerId}-${a.id}.png`)).toBe(true);
    }
    const heroAbilities = [...CATALOG.abilities.values()].filter((a) => a.cost !== undefined);
    const bossAbilities = [...CATALOG.abilities.values()].filter((a) => a.cost === undefined);
    expect(heroAbilities.length).toBe(20);
    expect(bossAbilities.length).toBe(18);
    for (const h of CATALOG.heroes) {
      expect(h.abilityIds.map((id) => CATALOG.abilities.get(id)!.cost)).toEqual([1, 2, 3, 4]);
      expect(h.levelImages[0]).toBe(`assets/starting-portraits/${h.id}.png`);
    }
    expect(CATALOG.heroes.reduce((s, h) => s + h.maxHp, 0)).toBe(506);
    expect(CATALOG.bosses.map((b) => [b.id, b.maxHp])).toEqual([
      ['fenrir', 640],
      ['yorigumo', 720],
    ]);
  });

  it('المحتوى غير الصالح يُعزل بدل تعطيل التطبيق', async () => {
    const { buildCatalog } = await import('../../src/catalog');
    const { HEROES, HERO_ABILITIES } = await import('../../src/catalog/heroes');
    const { BOSSES, BOSS_ABILITIES } = await import('../../src/catalog/bosses');
    const broken = { ...HEROES[0], id: 'broken', abilityIds: ['H1', 'H2', 'H3'] };
    const c = buildCatalog([...HEROES, broken], BOSSES, [...HERO_ABILITIES, ...BOSS_ABILITIES]);
    expect(c.heroById.has('broken')).toBe(false);
    expect(c.heroes.length).toBe(5);
    expect(c.problems.length).toBeGreaterThan(0);
  });
});
