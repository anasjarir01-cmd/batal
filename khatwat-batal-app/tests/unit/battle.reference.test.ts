// الحالات العددية المرجعية للقتال (القسم 21). كل حالة من حالة بداية مستقلة.
import { describe, expect, it } from 'vitest';
import {
  assignSlots,
  createBattle,
  deckZoneTotal,
  executeRound,
  legalTargets,
  planBossRound,
  validatePlan,
} from '../../src/engine/battle/engine';
import { battleWinners } from '../../src/engine/battle/rewards';
import { Rng } from '../../src/engine/rng';
import { act, battle, card, noop, roundEndSnapshot, run, SLOT, setBoss, slotSnapshot, TEAM, testContent, withHand } from './battleHelpers';

const { hayato: H, nuba: N, skadi: S, eir: E, zhuge: Z } = SLOT;

describe('ترتيب الخانات', () => {
  it('يوزع الأبطال على خانات الأدوار من اليمين لليسار', () => {
    expect(assignSlots(['zhuge', 'eir', 'skadi', 'nuba', 'hayato'], testContent)).toEqual(TEAM);
  });
});

describe('حالات القتال المرجعية', () => {
  it('1: H1 ضد F1 على هاياتو', () => {
    const s = battle();
    setBoss(s, act('F1', [H]));
    const { events } = run(s, [{ cardId: card('hayato', 'H1') }]);
    const snap = slotSnapshot(events, 0);
    expect(snap.heroes[H].hp).toBe(109);
    expect(snap.boss.hp).toBe(632);
    expect(snap.heroes[H].shield).toBeUndefined();
    expect(events.filter((e) => e.t === 'hit').length).toBe(2);
  });

  it('2: H2 على نوبا ضد F1 عليها — الصدّ يُستهلك ولا يبقى فائض', () => {
    const s = battle();
    setBoss(s, act('F1', [N]));
    const { events } = run(s, [{ cardId: card('hayato', 'H2'), target: N }]);
    const snap = slotSnapshot(events, 0);
    expect(snap.heroes[N].hp).toBe(88);
    expect(snap.heroes[N].shield).toBeUndefined();
  });

  it('2ب: صدّ لم يُصب في الجولة r يبقى حتى نهاية r+1 فقط', () => {
    const s = battle();
    setBoss(s);
    const r1 = run(s, [{ cardId: card('hayato', 'H2'), target: N }]);
    expect(roundEndSnapshot(r1.record.events).heroes[N].shield?.value).toBe(22);
    const s2 = r1.state;
    setBoss(s2);
    const r2 = executeRound(s2, [], testContent);
    expect(slotSnapshot(r2.record.events, 2).heroes[N].shield?.value).toBe(22);
    expect(roundEndSnapshot(r2.record.events).heroes[N].shield).toBeUndefined();
  });

  it('3: H2 على نوبا ضد F3 — الاختراق لا يدمر الصدّ', () => {
    const s = battle();
    setBoss(s, act('F3', [N]));
    const { events } = run(s, [{ cardId: card('hayato', 'H2'), target: N }]);
    const snap = slotSnapshot(events, 0);
    expect(snap.heroes[N].hp).toBe(71);
    expect(snap.heroes[N].shield?.value).toBe(22);
  });

  it('4: H2 على نوبا ضد F6 — 23+8−22=9', () => {
    const s = battle();
    setBoss(s, act('F6', [N]));
    const { events } = run(s, [{ cardId: card('hayato', 'H2'), target: N }]);
    const snap = slotSnapshot(events, 0);
    expect(snap.heroes[N].hp).toBe(79);
    expect(snap.heroes[N].shield).toBeUndefined();
  });

  it('5: N2 ضد Y7 في الخانة نفسها', () => {
    const s = battle('yorigumo');
    setBoss(s, act('Y7'));
    const { events } = run(s, [{ cardId: card('nuba', 'N2') }]);
    const snap = slotSnapshot(events, 0);
    expect(snap.boss.hp).toBe(706);
    expect(snap.heroes[N].hp).toBe(88);
    expect(snap.boss.shield).toBeUndefined();
    expect(events.some((e) => e.t === 'reflect')).toBe(false);
  });

  it('6: S2 ضد Y7 — الحاجز وانعكاسه باقيان', () => {
    const s = battle('yorigumo');
    setBoss(s, act('Y7'));
    const { events } = run(s, [{ cardId: card('skadi', 'S2') }]);
    const snap = slotSnapshot(events, 0);
    expect(snap.boss.hp).toBe(700);
    expect(snap.heroes[S].hp).toBe(96);
    expect(snap.boss.shield).toMatchObject({ value: 18, reflect: 8 });
  });

  it('7: N1 ضد Y7 — امتصاص وانعكاس واحتراق جديد ثم 716 بنهاية الجولة', () => {
    const s = battle('yorigumo');
    setBoss(s, act('Y7'));
    const { events } = run(s, [{ cardId: card('nuba', 'N1') }]);
    const snap = slotSnapshot(events, 0);
    expect(snap.heroes[N].hp).toBe(80);
    expect(snap.boss.hp).toBe(720);
    expect(snap.boss.burn).toMatchObject({ amount: 4, ticks: 2 });
    expect(roundEndSnapshot(events).boss.hp).toBe(716);
  });

  it('8: Y7 قائم قبل الخانة، ثم Y1 على نوبا مع N1', () => {
    const s = battle('yorigumo');
    s.boss.shield = { value: 18, reflect: 8, expiresRound: 2 };
    setBoss(s, act('Y1', [N]));
    const { events } = run(s, [{ cardId: card('nuba', 'N1') }]);
    const snap = slotSnapshot(events, 0);
    expect(snap.heroes[N].hp).toBe(66);
    expect(snap.heroes[N].poison).toMatchObject({ amount: 3, ticks: 2 });
    expect(snap.boss.burn).toMatchObject({ amount: 4, ticks: 2 });
  });

  it('9: نوبا 5HP؛ E1 عليها مع F1 → 2HP وتبقى حية', () => {
    const s = battle();
    s.heroes[N].hp = 5;
    setBoss(s, act('F1', [N]));
    const { events } = run(s, [{ cardId: card('eir', 'E1'), target: N }]);
    expect(slotSnapshot(events, 0).heroes[N].hp).toBe(2);
  });

  it('9ب: العلاج لا يبعث بطلًا ميتًا عند بداية الخانة', () => {
    const s = battle();
    s.heroes[N].hp = 5;
    setBoss(s, act('F1', [N]));
    const { events } = run(s, [{ cardId: card('hayato', 'H1') }, { cardId: card('eir', 'E1'), target: N }]);
    expect(slotSnapshot(events, 0).heroes[N].hp).toBe(0);
    expect(slotSnapshot(events, 1).heroes[N].hp).toBe(0);
    expect(events.some((e) => e.t === 'effectFailed' && e.unit === N)).toBe(true);
  });

  it('10: العلاج لا يُقص مبكرًا: 88+16−19=85', () => {
    const s = battle();
    setBoss(s, act('F1', [N]));
    const { events } = run(s, [{ cardId: card('eir', 'E1'), target: N }]);
    expect(slotSnapshot(events, 0).heroes[N].hp).toBe(85);
  });

  it('11: إير لا تستهدف نفسها في E1–E3، والتنفيذ يرفض ذلك أيضًا؛ E4 للآخرين فقط', () => {
    const s = battle();
    for (const a of ['E1', 'E2', 'E3']) {
      withHand(s, [card('eir', a)]);
      expect(legalTargets(s, card('eir', a), testContent)).not.toContain(E);
      expect(validatePlan(s, [{ cardId: card('eir', a), target: E }], testContent)).not.toBeNull();
      expect(() => executeRound(s, [{ cardId: card('eir', a), target: E }], testContent)).toThrow();
    }
    const t = battle();
    t.heroes[E].hp = 50;
    t.heroes[H].hp = 60;
    setBoss(t);
    const { events } = run(t, [{ cardId: card('eir', 'E4') }]);
    const snap = slotSnapshot(events, 0);
    expect(snap.heroes[E].hp).toBe(50);
    expect(snap.heroes[H].hp).toBe(80);
    expect(events.filter((e) => e.t === 'heal').map((e) => (e as { unit: number }).unit)).toEqual([H, N, S, Z]);
  });

  it('12: N4 من نوبا 5HP ضد فنرير 30HP وF1 عليها — تعادل بلا انتصارات', () => {
    const s = battle();
    for (const h of s.heroes) if (h.slot !== N) h.hp = 0;
    s.hand = s.hand.filter((id) => s.cards[id].ownerSlot === N);
    s.heroes[N].hp = 5;
    s.boss.hp = 30;
    setBoss(s, act('F1', [N]));
    const { state, events } = run(s, [{ cardId: card('nuba', 'N4') }]);
    expect(state.outcome).toBe('draw');
    expect(state.boss.hp).toBe(0);
    expect(state.heroes[N].hp).toBe(0);
    expect(events.some((e) => e.t === 'hit' && e.from === N)).toBe(true);
    expect(battleWinners(state)).toEqual([]);
  });

  it('13: موت نوبا في الخانة1 يلغي N4 المحجوزة للخانة2 دون ضرر أو سحب بديل', () => {
    const s = battle();
    s.heroes[N].hp = 5;
    setBoss(s, act('F1', [N]));
    const handBefore = s.hand.length;
    const { state, events } = run(s, [{ cardId: card('hayato', 'H1') }, { cardId: card('nuba', 'N4') }]);
    expect(slotSnapshot(events, 1).boss.hp).toBe(632);
    expect(events.some((e) => e.t === 'cardCancelled' && e.cardId === card('nuba', 'N4'))).toBe(true);
    expect(state.removed).toContain(card('nuba', 'N4'));
    expect(events.filter((e) => e.t === 'drawCards').length).toBe(1); // سحب واحد فقط في بداية الجولة التالية
    expect(handBefore).toBe(8);
  });

  it('14: N1 على فنرير: 6 ثم 4 ثم 4 = 14، والتجديد يجدد المدة فقط', () => {
    const s = battle();
    setBoss(s);
    const r1 = run(s, [{ cardId: card('nuba', 'N1') }]);
    expect(slotSnapshot(r1.record.events, 0).boss.hp).toBe(634);
    expect(roundEndSnapshot(r1.record.events).boss.hp).toBe(630);
    const s2 = r1.state;
    setBoss(s2);
    const r2 = executeRound(s2, [], testContent);
    expect(roundEndSnapshot(r2.record.events).boss.hp).toBe(626);
    expect(r2.state.boss.burn).toBeUndefined();
    // التجديد
    const t = battle();
    t.boss.burn = { amount: 4, ticks: 1 };
    setBoss(t);
    const r3 = run(t, [{ cardId: card('nuba', 'N1') }]);
    expect(slotSnapshot(r3.record.events, 0).boss.burn).toEqual({ amount: 4, ticks: 2 });
    expect(roundEndSnapshot(r3.record.events).boss.hp).toBe(640 - 6 - 4);
  });

  it('15: N3 ثم N4 = 24+48 = 72 دون نبضة احتراق، والحركة الثالثة للزعيم باقية', () => {
    const s = battle();
    setBoss(s, noop(), noop(), act('F7'));
    const { events } = run(s, [{ cardId: card('nuba', 'N3') }, { cardId: card('nuba', 'N4') }]);
    expect(slotSnapshot(events, 1).boss.hp).toBe(640 - 72);
    expect(slotSnapshot(events, 1).boss.burn).toBeUndefined();
    expect(roundEndSnapshot(events).boss.hp).toBe(568);
    expect(events.filter((e) => e.t === 'slotStart').length).toBe(3);
    expect(slotSnapshot(events, 2).boss.shield?.value).toBe(26);
  });

  it('16: N4 ضد F8 والزعيم محترق: F8 يطهر أولًا فتكون الضربة 36 مع علاج 24', () => {
    const s = battle();
    s.boss.hp = 600;
    s.boss.burn = { amount: 4, ticks: 2 };
    setBoss(s, act('F8'));
    const { events } = run(s, [{ cardId: card('nuba', 'N4') }]);
    const hit = events.find((e) => e.t === 'hit' && e.from === N);
    expect(hit && hit.t === 'hit' && hit.raw).toBe(36);
    expect(slotSnapshot(events, 0).boss.hp).toBe(600 + 24 - 36);
  });

  it('17: S1 ثم S4 = 6+52 = 58', () => {
    const s = battle();
    setBoss(s);
    const { events } = run(s, [{ cardId: card('skadi', 'S1') }, { cardId: card('skadi', 'S4') }]);
    expect(slotSnapshot(events, 0).boss.hp).toBe(634);
    expect(slotSnapshot(events, 1).boss.hp).toBe(640 - 58);
    expect(slotSnapshot(events, 1).boss.mark).toBeUndefined();
  });

  it('18: علامة10 + كشف16 + تركيز14 → S4 = 82 وتُستهلك شحنة واحدة', () => {
    const s = battle();
    s.boss.mark = { value: 10, expiresRound: 2 };
    s.boss.expose = { bonus: 16, charges: 2, expiresRound: 2 };
    s.heroes[S].focus = { value: 14, expiresRound: 2 };
    setBoss(s);
    const { events } = run(s, [{ cardId: card('skadi', 'S4') }]);
    const hit = events.find((e) => e.t === 'hit' && e.from === S);
    expect(hit && hit.t === 'hit' && hit.raw).toBe(82);
    const snap = slotSnapshot(events, 0);
    expect(snap.boss.hp).toBe(640 - 82);
    expect(snap.boss.mark).toBeUndefined();
    expect(snap.heroes[S].focus).toBeUndefined();
    expect(snap.boss.expose?.charges).toBe(1);
  });

  it('19: Z1 مع F4 لا يخفض F4 الحالي؛ وإضعاف قديم 6 يخفض 8→2 لكل بطل ويستهلك مرة', () => {
    const s = battle();
    setBoss(s, act('F4', [0, 1, 2, 3, 4]));
    const { events } = run(s, [{ cardId: card('zhuge', 'Z1') }]);
    const snap = slotSnapshot(events, 0);
    expect(snap.heroes.map((h) => h.maxHp - h.hp)).toEqual([8, 8, 8, 8, 8]);
    expect(snap.boss.weaken?.value).toBe(6);
    const t = battle();
    t.boss.weaken = { value: 6, expiresRound: 2 };
    setBoss(t, act('F4', [0, 1, 2, 3, 4]), act('F4', [0, 1, 2, 3, 4]));
    const r = run(t, []);
    expect(slotSnapshot(r.record.events, 0).heroes.map((h) => h.maxHp - h.hp)).toEqual([2, 2, 2, 2, 2]);
    expect(slotSnapshot(r.record.events, 0).boss.weaken).toBeUndefined();
    expect(slotSnapshot(r.record.events, 1).heroes.map((h) => h.maxHp - h.hp)).toEqual([10, 10, 10, 10, 10]);
  });

  it('20: صدّ22 ضد Y1 يمتص14 لكن السم يطبق ويخصم3 بنهاية الجولة', () => {
    const s = battle('yorigumo');
    s.heroes[H].shield = { value: 22, reflect: 0, expiresRound: 2 };
    setBoss(s, act('Y1', [H]));
    const { events } = run(s, []);
    expect(slotSnapshot(events, 0).heroes[H].hp).toBe(120);
    expect(slotSnapshot(events, 0).heroes[H].poison).toBeDefined();
    expect(roundEndSnapshot(events).heroes[H].hp).toBe(117);
  });

  it('21: E2 على حليف 40HP مسموم ضد Y9 → 33، ومع Y1 يعود سم جديد', () => {
    const s = battle('yorigumo');
    s.heroes[H].hp = 40;
    s.heroes[H].poison = { amount: 3, ticks: 2 };
    setBoss(s, act('Y9', [H]));
    const { events } = run(s, [{ cardId: card('eir', 'E2'), target: H }]);
    const snap = slotSnapshot(events, 0);
    expect(snap.heroes[H].hp).toBe(33);
    expect(snap.heroes[H].poison).toBeUndefined();
    const t = battle('yorigumo');
    t.heroes[H].hp = 40;
    t.heroes[H].poison = { amount: 3, ticks: 1 };
    setBoss(t, act('Y1', [H]));
    const r = run(t, [{ cardId: card('eir', 'E2'), target: H }]);
    const sn = slotSnapshot(r.record.events, 0);
    expect(sn.heroes[H].hp).toBe(40 + 20 - 14);
    expect(sn.heroes[H].poison).toEqual({ amount: 3, ticks: 2 });
  });

  it('22: Y6 ضد صدّ22 بلا علاج؛ ضد صدّ21 ضرر1 وعلاج12 ضمن سقف720', () => {
    const s = battle('yorigumo');
    s.boss.hp = 700;
    s.heroes[H].shield = { value: 22, reflect: 0, expiresRound: 2 };
    setBoss(s, act('Y6', [H]));
    let snap = slotSnapshot(run(s, []).record.events, 0);
    expect(snap.heroes[H].hp).toBe(120);
    expect(snap.boss.hp).toBe(700);
    const t = battle('yorigumo');
    t.boss.hp = 715;
    t.heroes[H].shield = { value: 21, reflect: 0, expiresRound: 2 };
    setBoss(t, act('Y6', [H]));
    snap = slotSnapshot(run(t, []).record.events, 0);
    expect(snap.heroes[H].hp).toBe(119);
    expect(snap.boss.hp).toBe(720);
  });

  it('23: Y5=24 ثم Y7=18 يبقى 24 بلا انعكاس ولا تجديد؛ والعكس يصبح 24 بلا انعكاس', () => {
    const s = battle('yorigumo');
    s.boss.shield = { value: 24, reflect: 0, expiresRound: 1 };
    setBoss(s, act('Y7'));
    const r = run(s, []);
    expect(slotSnapshot(r.record.events, 0).boss.shield).toEqual({ value: 24, reflect: 0, expiresRound: 1 });
    expect(roundEndSnapshot(r.record.events).boss.shield).toBeUndefined();
    const t = battle('yorigumo');
    t.boss.shield = { value: 18, reflect: 8, expiresRound: 2 };
    setBoss(t, act('Y5'));
    expect(slotSnapshot(run(t, []).record.events, 0).boss.shield).toEqual({ value: 24, reflect: 0, expiresRound: 2 });
  });

  it('24: هجوم مخفض إلى0 يبقى هجومًا: يستهلك العلامة والتركيز والحاجز ويشغل الانعكاس', () => {
    const s = battle('yorigumo');
    s.heroes[S].weaken = { value: 60, expiresRound: 2 };
    s.heroes[S].focus = { value: 14, expiresRound: 2 };
    s.boss.mark = { value: 10, expiresRound: 2 };
    s.boss.shield = { value: 18, reflect: 8, expiresRound: 2 };
    setBoss(s);
    const { events } = run(s, [{ cardId: card('skadi', 'S1') }]);
    const snap = slotSnapshot(events, 0);
    expect(snap.boss.hp).toBe(720);
    expect(snap.boss.shield).toBeUndefined();
    expect(snap.heroes[S].focus).toBeUndefined();
    expect(snap.heroes[S].weaken).toBeUndefined();
    expect(snap.heroes[S].hp).toBe(88);
    // S1 يضع علامة جديدة بعد الخانة
    expect(snap.boss.mark?.value).toBe(10);
  });

  it('24ب: الإضعاف القديم للزعيم لا يُستهلك إذا لم يوجد هدف حي للهجوم', () => {
    const s = battle();
    s.heroes[N].hp = 5;
    s.boss.weaken = { value: 6, expiresRound: 2 };
    // الخانة1: F3 يقتل نوبا (ثاقب، يتجاوز الإضعاف؟ لا: الإضعاف يُطبق). نستعمل F9 19−6=13 ≥ 5
    setBoss(s, act('F9', [N]), act('F1', [N]));
    const { events } = run(s, []);
    expect(slotSnapshot(events, 0).heroes[N].hp).toBe(0);
    expect(slotSnapshot(events, 0).boss.weaken).toBeUndefined(); // استُهلك بالهجوم الأول
    const t = battle();
    t.heroes[N].hp = 0;
    t.hand = t.hand.filter((id) => t.cards[id].ownerSlot !== N);
    t.boss.weaken = { value: 6, expiresRound: 2 };
    setBoss(t, act('F1', [N]));
    const r = run(t, []);
    expect(slotSnapshot(r.record.events, 0).boss.weaken?.value).toBe(6);
  });

  it('25: فنرير 325 → 305 بـS2 يعلق المرحلة2، ثم F8 يعيده 329، والمرحلة2 تبدأ في الجولة التالية', () => {
    const s = battle();
    s.boss.hp = 325;
    setBoss(s, noop(), act('F8'));
    const { state, events } = run(s, [{ cardId: card('skadi', 'S2') }]);
    expect(slotSnapshot(events, 0).boss.hp).toBe(305);
    expect(slotSnapshot(events, 0).phase2Pending).toBe(true);
    expect(slotSnapshot(events, 1).boss.hp).toBe(329);
    expect(state.phase).toBe(2);
    expect(events.some((e) => e.t === 'phase2')).toBe(true);
  });

  it('26: أهداف الزعيم ثابتة خلال الجولة، ولا إعادة توجيه عند السقوط', () => {
    const s = battle('yorigumo');
    s.heroes[N].hp = 5;
    // المرحلة2 تختار المسمومين؛ الأهداف محسوبة مسبقًا لا تتغير بتطهير أثناء الجولة
    setBoss(s, act('Y8', [0, 1, 2, 3, 4]), act('Y1', [N]), act('Y2', [H]));
    const { events } = run(s, [{ cardId: card('eir', 'E2'), target: H }]);
    const starts = events.filter((e) => e.t === 'slotStart');
    expect(starts.map((e) => (e.t === 'slotStart' ? e.boss.targets : []))).toEqual([[0, 1, 2, 3, 4], [N], [H]]);
    // نوبا سقطت في الخانة1، فلا ضرر على بديل في الخانة2
    const slot2Hits = events.filter((e) => e.t === 'hit' && e.seq > (starts[1] as { seq: number }).seq && e.seq < (starts[2] as { seq: number }).seq);
    expect(slot2Hits.length).toBe(0);
  });

  it('26ب: المرحلة2 لفنرير تستعمل نسبة الحياة لا الحياة المطلقة، وترتيب الخانات عند التساوي', () => {
    const base = battle();
    base.phase = 2;
    base.heroes[H].hp = 50; // 0.417
    base.heroes[N].hp = 40; // 0.4545 (أقل حياة مطلقة بعد إير)
    base.heroes[S].hp = 90;
    base.heroes[E].hp = 30; // 0.273
    base.heroes[Z].hp = 45; // 0.489
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) {
      const s = structuredClone(base);
      s.seed = `seed-${i}`;
      s.bossCycle = -1;
      planBossRound(s, testContent);
      for (const a of s.bossPlan) if (testContent.ability(a.abilityId).bossTarget === 'single') a.targets.forEach((t) => seen.add(t));
    }
    expect([...seen].sort()).toEqual([H, E].sort());
    const tie = battle();
    tie.phase = 2;
    for (const h of tie.heroes) h.hp = Math.floor(h.maxHp / 2);
    tie.heroes[N].hp = 44; // 44/88 = 0.5
    tie.heroes[Z].hp = 46; // 46/92 = 0.5
    tie.heroes[H].hp = 60; // 0.5
    tie.heroes[S].hp = 48;
    tie.heroes[E].hp = 55;
    const seenTie = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const s = structuredClone(tie);
      s.seed = `tie-${i}`;
      s.bossCycle = -1;
      planBossRound(s, testContent);
      for (const a of s.bossPlan) if (testContent.ability(a.abilityId).bossTarget === 'single') a.targets.forEach((t) => seenTie.add(t));
    }
    expect([...seenTie].sort()).toEqual([H, N]);
  });

  it('26ج: يوريغومو في المرحلة2 تختار المسمومين عند بداية الجولة', () => {
    const base = battle('yorigumo');
    base.phase = 2;
    base.heroes[S].poison = { amount: 3, ticks: 2 };
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const s = structuredClone(base);
      s.seed = `p-${i}`;
      s.bossCycle = -1;
      planBossRound(s, testContent);
      for (const a of s.bossPlan) if (testContent.ability(a.abilityId).bossTarget === 'single') a.targets.forEach((t) => seen.add(t));
    }
    expect([...seen]).toEqual([S]);
  });

  it('27: بطل وحيد 3HP مسموم وزعيم 4HP محترق → كلاهما يموت بنهاية الجولة؛ تعادل', () => {
    const s = battle();
    for (const h of s.heroes) if (h.slot !== H) h.hp = 0;
    s.hand = s.hand.filter((id) => s.cards[id].ownerSlot === H);
    s.heroes[H].hp = 3;
    s.heroes[H].poison = { amount: 3, ticks: 2 };
    s.boss.hp = 4;
    s.boss.burn = { amount: 4, ticks: 2 };
    setBoss(s);
    const { state } = run(s, []);
    expect(state.outcome).toBe('draw');
    expect(state.boss.hp).toBe(0);
    expect(state.heroes[H].hp).toBe(0);
  });

  it('28: انتهاء القتال في الخانة1 يمنع الخانتين 2 و3 ونبضات النهاية', () => {
    const s = battle();
    s.boss.hp = 5;
    s.boss.burn = { amount: 4, ticks: 2 };
    s.heroes[H].poison = { amount: 3, ticks: 2 };
    setBoss(s, noop(), act('F1', [H]), act('F1', [H]));
    const { state, events } = run(s, [{ cardId: card('nuba', 'N1') }, { cardId: card('skadi', 'S1') }]);
    expect(state.outcome).toBe('victory');
    expect(events.filter((e) => e.t === 'slotStart').length).toBe(1);
    expect(events.some((e) => e.t === 'dotTick')).toBe(false);
    expect(state.heroes[H].hp).toBe(120);
    expect(state.boss.burn).toBeDefined(); // أثر جديد لا يمنح ضربة بعد النهاية
    expect(battleWinners(state)).toEqual(TEAM);
  });

  it('29: ثوابت الطاقة والخطة والرزمة عبر معارك عشوائية كاملة', () => {
    for (let g = 0; g < 60; g++) {
      const rng = new Rng(`sim-${g}`);
      let s = createBattle({ battleId: `sim-${g}`, seed: `sim-${g}`, bossId: g % 2 ? 'fenrir' : 'yorigumo', teamHeroIds: TEAM }, testContent);
      let guard = 0;
      while (!s.outcome && guard++ < 200) {
        const alive = s.heroes.filter((h) => h.hp > 0).length;
        expect(deckZoneTotal(s)).toBe(4 * alive);
        expect(s.energy).toBe(7);
        expect(new Set([...s.hand, ...s.draw, ...s.discard, ...s.removed]).size).toBe(20);
        expect(s.hand.length).toBeLessThanOrEqual(8);
        // خطة عشوائية قانونية
        const plan: { cardId: string; target?: number }[] = [];
        let energy = 7;
        for (const id of rng.shuffle(s.hand)) {
          if (plan.length >= 3) break;
          const cost = testContent.ability(s.cards[id].abilityId).cost ?? 0;
          if (cost > energy) continue;
          const a = testContent.ability(s.cards[id].abilityId);
          let target: number | undefined;
          if (a.heroTarget !== 'none') {
            const lt = legalTargets(s, id, testContent);
            if (!lt.length) continue;
            target = rng.pick(lt);
          }
          plan.push({ cardId: id, target });
          energy -= cost;
        }
        expect(validatePlan(s, plan, testContent)).toBeNull();
        s = executeRound(s, plan, testContent).state;
      }
      expect(s.outcome).toBeDefined();
    }
  });

  it('29ب: الخطة ترفض الطاقة الزائدة والتكرار وأكثر من ثلاث بطاقات', () => {
    const s = battle();
    withHand(s, [card('nuba', 'N4'), card('skadi', 'S4'), card('hayato', 'H1'), card('skadi', 'S1')]);
    expect(validatePlan(s, [{ cardId: card('nuba', 'N4') }, { cardId: card('skadi', 'S4') }], testContent)).toMatch(/الطاقة/);
    expect(validatePlan(s, [{ cardId: card('hayato', 'H1') }, { cardId: card('hayato', 'H1') }], testContent)).toMatch(/مرتين/);
    withHand(s, [card('nuba', 'N1'), card('eir', 'E1')]);
    expect(
      validatePlan(s, [{ cardId: card('hayato', 'H1') }, { cardId: card('skadi', 'S1') }, { cardId: card('nuba', 'N1') }, { cardId: card('eir', 'E1'), target: H }], testContent),
    ).toMatch(/ثلاث/);
    expect(validatePlan(s, [], testContent)).toBeNull();
  });

  it('30: الزعيم يستعمل التسع مرة قبل الخلط، والإخفاء 1،1،2، والأهداف المزدوجة مختلفة، وخطة اللاعب لا تغير مستقبله', () => {
    const seqA: string[] = [];
    const hiddenCounts: number[] = [];
    let s = createBattle({ battleId: 'z', seed: 'boss-seq', bossId: 'fenrir', teamHeroIds: TEAM }, testContent);
    s.boss.hp = 100000;
    s.boss.maxHp = 100000;
    for (let r = 1; r <= 9; r++) {
      seqA.push(...s.bossPlan.map((a) => a.abilityId));
      hiddenCounts.push(s.bossPlan.filter((a) => a.hidden).length);
      for (const a of s.bossPlan) if (testContent.ability(a.abilityId).bossTarget === 'double') expect(new Set(a.targets).size).toBe(a.targets.length);
      for (const h of s.heroes) h.hp = h.maxHp; // إبقاء الجميع أحياء لعزل الترتيب
      s = executeRound(s, [], testContent).state;
    }
    for (let c = 0; c < 3; c++) expect(new Set(seqA.slice(c * 9, c * 9 + 9)).size).toBe(9);
    expect(hiddenCounts).toEqual([1, 1, 2, 1, 1, 2, 1, 1, 2]);
    // خطة لاعب مختلفة لا تغير ترتيب بطاقات الزعيم المستقبلية
    let t = createBattle({ battleId: 'z', seed: 'boss-seq', bossId: 'fenrir', teamHeroIds: TEAM }, testContent);
    t.boss.hp = 100000;
    t.boss.maxHp = 100000;
    const seqB: string[] = [];
    const planA = t.bossPlan.map((a) => ({ ...a }));
    const alt = structuredClone(t);
    withHand(alt, [card('hayato', 'H1')]);
    const planAfterAlt = executeRound(alt, [{ cardId: card('hayato', 'H1') }], testContent);
    expect(planAfterAlt.record.before.bossPlan).toEqual(planA);
    for (let r = 1; r <= 9; r++) {
      seqB.push(...t.bossPlan.map((a) => a.abilityId));
      for (const h of t.heroes) h.hp = h.maxHp;
      const hand = t.hand.filter((id) => testContent.ability(t.cards[id].abilityId).heroTarget === 'none');
      t = executeRound(t, [{ cardId: hand[0] }], testContent).state;
    }
    expect(seqB).toEqual(seqA);
  });

  it('31: المستوى التجميلي والرتبة لا يدخلان في الحساب؛ الفوز يمنح الخمسة +1 والتعادل لا شيء', () => {
    const a = battle('fenrir', 'same');
    const b = battle('fenrir', 'same');
    setBoss(a, act('F1', [H]));
    setBoss(b, act('F1', [H]));
    const ra = run(a, [{ cardId: card('hayato', 'H1') }]);
    const rb = run(b, [{ cardId: card('hayato', 'H1') }]);
    expect(ra.state).toEqual(rb.state);
    const win = battle();
    win.heroes[N].hp = 0;
    win.boss.hp = 3;
    setBoss(win);
    const rw = run(win, [{ cardId: card('skadi', 'S1') }]);
    expect(rw.state.outcome).toBe('victory');
    expect(battleWinners(rw.state)).toEqual(TEAM); // حتى الساقطة نوبا
  });
});
