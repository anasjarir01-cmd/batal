import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { rankCompletionRewards } from '../../src/catalog/unlocks';
import { DATA_MIGRATIONS, openAppDb, runDataMigrations } from '../../src/store/db';
import {
  addTrack,
  buyHero,
  chooseBoss,
  commitRound,
  completeChallenge,
  confirmTeam,
  finishBattle,
  initIfNeeded,
  loadAll,
  OpError,
  purchaseReward,
  putBlob,
  reconcileEntitlements,
  retreatBattle,
  saveChallenge,
  saveReward,
  uid,
} from '../../src/store/ops';
import { exportBackup, importBackup, parseBackup } from '../../src/store/backup';
import { unzipSync, zipSync } from 'fflate';

let n = 0;
async function freshDb() {
  const db = await openAppDb(`test-db-${++n}-${uid()}`);
  await initIfNeeded(db);
  return db;
}

const day = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0);
const errCode = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof OpError ? e.code : String(e);
  }
};

describe('التهيئة', () => {
  it('أول تشغيل: أرصدة صفرية، خمسة أبطال مملوكون بمستوى1، زعيمان مفتوحان؛ ولا تُعاد التهيئة', async () => {
    const db = await freshDb();
    const d = await loadAll(db);
    expect([d.profile.xp, d.profile.coins, d.profile.gems]).toEqual([0, 0, 0]);
    expect(d.heroes.map((h) => [h.heroId, h.wins]).sort()).toEqual(
      ['eir', 'hayato', 'nuba', 'skadi', 'zhuge'].map((id) => [id, 0]),
    );
    expect(d.bosses.map((b) => b.bossId).sort()).toEqual(['fenrir', 'yorigumo']);
    expect(d.challenges).toEqual([]);
    expect(d.rewards).toEqual([]);
    expect(await initIfNeeded(db)).toBe(false);
  });
});

describe('التحديات', () => {
  it('الإكمال يمنح مرة واحدة؛ الضغط المزدوج المتزامن يصرف مرة واحدة', async () => {
    const db = await freshDb();
    const ch = await saveChallenge(db, { name: 'قراءة', description: '', imageId: null, difficulty: 'medium', recurrence: 'daily' });
    const now = day(2026, 6, 10);
    const results = await Promise.all([completeChallenge(db, ch.id, now).then(() => 'ok', (e) => e.code), completeChallenge(db, ch.id, now).then(() => 'ok', (e) => e.code)]);
    expect(results.sort()).toEqual(['already-done', 'ok']);
    const d = await loadAll(db, now);
    expect([d.profile.xp, d.profile.coins]).toEqual([40, 8]);
  });

  it('لسانان (اتصالان مختلفان) لا يسببان صرفًا مزدوجًا', async () => {
    const name = `tabs-${uid()}`;
    const a = await openAppDb(name);
    await initIfNeeded(a);
    const b = await openAppDb(name);
    const ch = await saveChallenge(a, { name: 'مشي', description: '', imageId: null, difficulty: 'hard', recurrence: 'once' });
    const r = await Promise.all([errCode(completeChallenge(a, ch.id)), errCode(completeChallenge(b, ch.id))]);
    expect(r.sort()).toEqual(['already-done', 'ok']);
    expect((await loadAll(a)).profile.xp).toBe(80);
  });

  it('اليومي يتجدد في اليوم المحلي التالي، والمرة الواحدة لا تتجدد', async () => {
    const db = await freshDb();
    const daily = await saveChallenge(db, { name: 'يومي', description: '', imageId: null, difficulty: 'easy', recurrence: 'daily' });
    const once = await saveChallenge(db, { name: 'هدف', description: '', imageId: null, difficulty: 'legendary', recurrence: 'once' });
    await completeChallenge(db, daily.id, day(2026, 6, 10, 23));
    await completeChallenge(db, once.id, day(2026, 6, 10, 23));
    expect(await errCode(completeChallenge(db, daily.id, day(2026, 6, 10, 23)))).toBe('already-done');
    expect(await errCode(completeChallenge(db, daily.id, day(2026, 6, 11, 0)))).toBe('ok');
    expect(await errCode(completeChallenge(db, once.id, day(2026, 8, 1)))).toBe('already-done');
    const d = await loadAll(db, day(2026, 6, 11));
    expect(d.profile.xp).toBe(20 + 1000 + 20);
    // لا ترحيل للأيام الفائتة ولا عقوبة
    expect(await errCode(completeChallenge(db, daily.id, day(2026, 6, 20)))).toBe('ok');
    expect((await loadAll(db)).profile.xp).toBe(1060);
  });

  it('4: تعديل المكافأة قبل الإكمال يطبق اليوم، وبعده لا يعيد الصرف ولا يعدل التاريخ', async () => {
    const db = await freshDb();
    const ch = await saveChallenge(db, { name: 'تمرين', description: '', imageId: null, difficulty: 'easy', recurrence: 'daily' });
    await saveChallenge(db, { id: ch.id, name: 'تمرين', description: '', imageId: null, difficulty: 'hard', recurrence: 'daily' });
    const today = day(2026, 6, 10);
    await completeChallenge(db, ch.id, today);
    expect((await loadAll(db, today)).profile.xp).toBe(80);
    await saveChallenge(db, { id: ch.id, name: 'تمرين معدل', description: '', imageId: null, difficulty: 'open', customXp: 5000, customCoins: 7, recurrence: 'daily' });
    expect(await errCode(completeChallenge(db, ch.id, today))).toBe('already-done');
    const d = await loadAll(db, today);
    expect(d.profile.xp).toBe(80);
    expect(d.completions[0].snapshot).toMatchObject({ name: 'تمرين', xp: 80, coins: 16, difficulty: 'hard' });
    await completeChallenge(db, ch.id, day(2026, 6, 11));
    expect((await loadAll(db)).profile.xp).toBe(5080);
  });

  it('مهمة مرة واحدة مكتملة لا يعيد تغيير النوع تسليحها', async () => {
    const db = await freshDb();
    const ch = await saveChallenge(db, { name: 'هدف', description: '', imageId: null, difficulty: 'easy', recurrence: 'once' });
    await completeChallenge(db, ch.id);
    expect(await errCode(saveChallenge(db, { id: ch.id, name: 'هدف', description: '', imageId: null, difficulty: 'easy', recurrence: 'daily' }))).toBe('invalid');
  });

  it('8: مكافأة ضخمة تعبر كل المستويات تسوي الأشرطة مرة واحدة، وإعادة التحميل لا تعيد الصرف', async () => {
    const db = await freshDb();
    const ch = await saveChallenge(db, { name: 'إنجاز', description: '', imageId: null, difficulty: 'open', customXp: 315180, customCoins: 0, recurrence: 'once' });
    const r = await completeChallenge(db, ch.id);
    expect(r.levelsCompleted).toEqual(Array.from({ length: 45 }, (_, i) => i + 1));
    expect(r.ranksCompleted).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    let d = await loadAll(db);
    expect(d.profile.gems).toBe(2700);
    expect(d.entitlements.length).toBe(18);
    expect(d.entitlements.every((e) => e.bossId === null)).toBe(true);
    await initIfNeeded(db);
    await reconcileEntitlements(db);
    d = await loadAll(db);
    expect(d.profile.gems).toBe(2700);
    expect(d.bosses.length).toBe(2);
  });
});

describe('استحقاقات الزعماء', () => {
  it('الاستحقاق غير المعيّن يبقى محفوظًا ثم يُطبّق مرة واحدة عند ربط محتوى صالح', async () => {
    const db = await freshDb();
    // محاكاة زعيم مقفل حقيقي: نحذف يوريغومو من المفتوحين في قاعدة الاختبار فقط
    await db.delete('bosses', 'yorigumo');
    const ch = await saveChallenge(db, { name: 'x', description: '', imageId: null, difficulty: 'open', customXp: 15300, customCoins: 0, recurrence: 'once' });
    await completeChallenge(db, ch.id);
    let d = await loadAll(db);
    expect(d.entitlements).toMatchObject([{ key: 'rank:1:0', bossId: null }]);
    const saved = rankCompletionRewards[1][0];
    try {
      rankCompletionRewards[1][0] = 'not-a-boss';
      expect(await reconcileEntitlements(db)).toEqual([]); // محتوى غير صالح لا يستهلك الاستحقاق
      rankCompletionRewards[1][0] = 'yorigumo';
      expect(await reconcileEntitlements(db)).toEqual(['yorigumo']);
      expect(await reconcileEntitlements(db)).toEqual([]);
      d = await loadAll(db);
      expect(d.bosses.map((b) => b.bossId).sort()).toEqual(['fenrir', 'yorigumo']);
      expect(d.entitlements[0]).toMatchObject({ bossId: 'yorigumo' });
    } finally {
      rankCompletionRewards[1][0] = saved;
    }
  });
});

describe('الجوائز والأبطال', () => {
  it('2/9: رصيد ناقص لا يغير شيئًا؛ المتكررة تُشترى بتأكيد جديد؛ نفس التأكيد لا يُصرف مرتين؛ المرة الواحدة تُمنع ثانية', async () => {
    const db = await freshDb();
    const cinema = await saveReward(db, { name: 'سينما', description: '', imageId: null, price: 50, recurrence: 'repeat' });
    const once = await saveReward(db, { name: 'كتاب', description: '', imageId: null, price: 10, recurrence: 'once' });
    const before = await loadAll(db);
    const e = await purchaseReward(db, cinema.id, uid()).catch((x) => x);
    expect(e).toBeInstanceOf(OpError);
    expect(e.code).toBe('insufficient');
    expect(e.details.missing).toBe(50);
    const after = await loadAll(db);
    expect(after.profile).toEqual(before.profile);
    expect(await db.count('purchases')).toBe(0);
    expect(await db.count('ledger')).toBe(0);
    // تمويل
    const ch = await saveChallenge(db, { name: 'x', description: '', imageId: null, difficulty: 'legendary', recurrence: 'once' });
    await completeChallenge(db, ch.id);
    const t1 = uid();
    await purchaseReward(db, cinema.id, t1);
    expect(await errCode(purchaseReward(db, cinema.id, t1))).toBe('duplicate');
    await purchaseReward(db, cinema.id, uid());
    await purchaseReward(db, once.id, uid());
    expect(await errCode(purchaseReward(db, once.id, uid()))).toBe('already-done');
    const d = await loadAll(db);
    expect(d.profile.coins).toBe(200 - 50 - 50 - 10);
    expect(d.purchasedOnce).toEqual([once.id]);
    expect(d.profile.xp).toBe(1000); // الشراء لا يرفع XP
  });

  it('9: البطل المملوك لا يُشترى ثانية؛ الشراء ذري بالجواهر ويبدأ بصفر انتصارات', async () => {
    const db = await freshDb();
    expect(await errCode(buyHero(db, 'hayato'))).toBe('owned');
    expect(await errCode(buyHero(db, 'ghost-hero'))).toBe('not-found');
    // محاكاة بطل غير مملوك في قاعدة الاختبار فقط
    await db.delete('heroes', 'zhuge');
    expect(await errCode(buyHero(db, 'zhuge'))).toBe('insufficient');
    const ch = await saveChallenge(db, { name: 'x', description: '', imageId: null, difficulty: 'open', customXp: 3060, customCoins: 0, recurrence: 'once' });
    await completeChallenge(db, ch.id);
    expect((await loadAll(db)).profile.gems).toBe(100);
    const r = await Promise.all([errCode(buyHero(db, 'zhuge')), errCode(buyHero(db, 'zhuge'))]);
    expect(r.sort()).toEqual(['ok', 'owned']);
    const d = await loadAll(db);
    expect(d.profile.gems).toBe(0);
    expect(d.heroes.find((h) => h.heroId === 'zhuge')).toMatchObject({ wins: 0, source: 'purchase' });
  });
});

describe('المعركة في التخزين', () => {
  it('الروليت محفوظ، الخطة القديمة (rev) تُرفض، والفوز يُسوى مرة واحدة', async () => {
    const db = await freshDb();
    let rec = await confirmTeam(db, 0, ['zhuge', 'eir', 'skadi', 'nuba', 'hayato']);
    expect(rec.prep?.teamHeroIds).toEqual(['hayato', 'nuba', 'skadi', 'eir', 'zhuge']);
    expect(rec.prep?.candidates.slice().sort()).toEqual(['fenrir', 'yorigumo']);
    const reloaded = await loadAll(db);
    expect(reloaded.battle.prep).toEqual(rec.prep);
    expect(await errCode(chooseBoss(db, 0, 'fenrir'))).toBe('stale');
    rec = await chooseBoss(db, rec.rev, 'fenrir');
    const s = rec.state!;
    expect(s.hand.length).toBe(8);
    // ضغطتان على التنفيذ بنفس rev: الثانية تُرفض
    const r1 = commitRound(db, rec.rev, []);
    const r2 = commitRound(db, rec.rev, []);
    const [a, b] = await Promise.all([errCode(r1), errCode(r2)]);
    expect([a, b].sort()).toEqual(['ok', 'stale']);
    const after = (await loadAll(db)).battle;
    expect(after.state!.round).toBe(2);
    expect(after.execution?.events.length).toBeGreaterThan(0);
    // إعادة التحميل لا تعيد خلط اليد أو خطة الزعيم
    const again = (await loadAll(db)).battle;
    expect(again.state!.hand).toEqual(after.state!.hand);
    expect(again.state!.bossPlan).toEqual(after.state!.bossPlan);
    // فرض فوز: زعيم بحياة 1 ثم ضربة
    const st = structuredClone(after.state!);
    st.boss.hp = 1;
    st.boss.shield = undefined;
    // خطة زعيم ثابتة بلا علاج حتى لا يعتمد الاختبار على البذرة العشوائية
    st.bossPlan = [0, 1, 2].map(() => ({ abilityId: 'F1', targets: [0], hidden: false }));
    await db.put('battle', { ...after, state: st });
    const card = st.hand.find((id) => ['H1', 'N1', 'N2', 'S1', 'S2'].includes(st.cards[id].abilityId));
    const plan = card ? [{ cardId: card }] : [];
    if (!card) {
      // لا بطاقة هجوم في اليد: نضع واحدة
      st.hand[0] = 'skadi:S1';
      st.draw = st.draw.filter((x) => x !== 'skadi:S1');
      st.discard = st.discard.filter((x) => x !== 'skadi:S1');
      await db.put('battle', { ...after, state: st });
      plan.push({ cardId: 'skadi:S1' });
    }
    const fin = await commitRound(db, after.rev, plan);
    expect(fin.state!.outcome).toBe('victory');
    expect(fin.settled?.winners.length).toBe(5);
    const heroes = (await loadAll(db)).heroes;
    expect(heroes.every((h) => h.wins === 1)).toBe(true);
    expect(await errCode(commitRound(db, fin.rev, []))).toBe('invalid');
    await finishBattle(db, fin.rev);
    expect((await loadAll(db)).heroes.every((h) => h.wins === 1)).toBe(true);
    expect((await loadAll(db)).battle.state).toBeUndefined();
  });

  it('الانسحاب لا يمنح انتصارات ولا يخصم شيئًا', async () => {
    const db = await freshDb();
    let rec = await confirmTeam(db, 0, ['hayato', 'nuba', 'skadi', 'eir', 'zhuge']);
    rec = await chooseBoss(db, rec.rev, rec.prep!.candidates[0]);
    rec = await retreatBattle(db, rec.rev);
    expect(rec.state!.outcome).toBe('retreat');
    const d = await loadAll(db);
    expect(d.heroes.every((h) => h.wins === 0)).toBe(true);
    expect([d.profile.coins, d.profile.gems, d.profile.xp]).toEqual([0, 0, 0]);
  });
});

describe('النسخ الاحتياطي والمهاجرات', () => {
  async function populated() {
    const db = await freshDb();
    const img = await putBlob(db, { data: new Uint8Array([137, 80, 78, 71, 1, 2, 3]).buffer, type: 'image/png', name: 'c.png' }, 'challenge');
    const ch = await saveChallenge(db, { name: 'صورة', description: 'وصف', imageId: img.id, difficulty: 'hard', recurrence: 'daily' });
    await completeChallenge(db, ch.id);
    await saveReward(db, { name: 'حلوى', description: '', imageId: null, price: 5, recurrence: 'repeat' });
    const song = new Uint8Array(4096).map((_, i) => i % 251);
    await addTrack(db, { data: song.buffer, type: 'audio/mpeg', name: 'song.mp3' });
    let rec = await confirmTeam(db, 0, ['hayato', 'nuba', 'skadi', 'eir', 'zhuge']);
    rec = await chooseBoss(db, rec.rev, 'yorigumo');
    await commitRound(db, rec.rev, []);
    return db;
  }

  it('تصدير → مسح بيئة اختبار → استيراد يعيد الصور والأغاني والتقدم والمعركة', async () => {
    const src = await populated();
    const before = await loadAll(src);
    const { bytes } = await exportBackup(src);
    const target = await openAppDb(`restore-${uid()}`);
    const parsed = await parseBackup(bytes);
    await importBackup(target, parsed);
    const after = await loadAll(target);
    expect(after.profile).toEqual(before.profile);
    expect(after.challenges).toEqual(before.challenges);
    expect(after.tracks).toEqual(before.tracks);
    expect(after.battle).toEqual(before.battle);
    expect(after.completions).toEqual(before.completions);
    const img = await target.get('blobs', after.challenges[0].imageId!);
    expect(new Uint8Array(img.data)).toEqual(new Uint8Array([137, 80, 78, 71, 1, 2, 3]));
    const song = await target.get('blobs', after.tracks[0].blobId);
    expect(song.data.byteLength).toBe(4096);
    // الاستيراد لا يدمج ولا يضاعف: استيراد ثانٍ يعطي نفس الأرصدة
    await importBackup(target, parsed);
    expect((await loadAll(target)).profile).toEqual(before.profile);
    // الوسائط ملفات ثنائية فعلية داخل ZIP
    const entries = unzipSync(bytes);
    expect(Object.keys(entries).filter((k) => k.startsWith('media/')).length).toBe(2);
  });

  it('ملف احتياطي غير صالح يُرفض دون تخريب البيانات', async () => {
    const db = await populated();
    const before = await loadAll(db);
    const { bytes } = await exportBackup(db);
    expect(await errCode(parseBackup(new Uint8Array([1, 2, 3])))).toBe('invalid');
    const entries = unzipSync(bytes);
    const mediaKey = Object.keys(entries).find((k) => k.startsWith('media/'))!;
    const tampered = { ...entries, [mediaKey]: new Uint8Array(entries[mediaKey].length) };
    expect(await errCode(parseBackup(zipSync(tampered)))).toBe('invalid');
    const missing = { ...entries };
    delete missing[mediaKey];
    expect(await errCode(parseBackup(zipSync(missing)))).toBe('invalid');
    const data = JSON.parse(new TextDecoder().decode(entries['data.json']));
    data.profile[0].coins += 1000;
    const inflated = { ...entries, 'data.json': new TextEncoder().encode(JSON.stringify(data)) };
    expect(await errCode(parseBackup(zipSync(inflated)))).toBe('invalid');
    expect(await loadAll(db)).toEqual(before);
  });

  it('المهاجرات تحافظ على البيانات ولا تعيد seed البداية', async () => {
    const db = await populated();
    const before = await loadAll(db);
    await db.put('meta', { key: 'schemaVersion', value: 1 });
    DATA_MIGRATIONS.push({
      to: 2,
      run: async (d) => {
        const all = await d.getAll('challenges');
        for (const c of all) await d.put('challenges', { ...c, migratedFlag: true });
      },
    });
    try {
      expect(await runDataMigrations(db)).toBe(2);
      expect(await initIfNeeded(db)).toBe(false);
      const after = await loadAll(db);
      expect(after.profile).toEqual(before.profile);
      expect(after.tracks).toEqual(before.tracks);
      expect((after.challenges[0] as unknown as { migratedFlag: boolean }).migratedFlag).toBe(true);
      expect(await runDataMigrations(db)).toBe(2);
    } finally {
      DATA_MIGRATIONS.pop();
    }
  });
});
