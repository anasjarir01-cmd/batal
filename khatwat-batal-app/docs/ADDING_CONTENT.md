# دليل إضافة بطل أو زعيم

المحتوى كله في `src/catalog/`. محرك القتال والمتجر والمجموعة يقرؤون الكتالوج ولا يفترضون خمسة أبطال أو زعيمين بعينهم، فلا تحتاج أي صفحة لإعادة البناء. بيانات المستخدم القديمة لا تتغير، لأن المعرّفات (IDs) ثابتة والإضافة لا تلمس IndexedDB.

## 1) الصور
1. ضع الصور PNG الأصلية تحت `public/assets/<مجلد-الشخصية>/`، والصورة الأساسية تحت `public/assets/starting-portraits/`. انتبه لحالة الأحرف، فالنشر على Linux يفرّق بين الحروف الكبيرة والصغيرة.
2. أضف كل ملف إلى `asset-sources/asset-manifest.json` بالمسار والحجم والبصمة (`sha256sum`).
3. شغّل `npm run assets:prepare` لتوليد نسخ العرض WebP وتحديث `src/catalog/assetIndex.generated.json`. تنزيل العمل دون إنترنت يعتمد على هذا الفهرس.
4. شغّل `npm run verify:assets`.

قاعدة التسمية لبطاقات القدرات: `<ownerId>-<abilityId>.png`، مثل `hayato-H1.png`. هذه القاعدة يتحقق منها اختبار الكتالوج.

## 2) بطل جديد
أضف تعريفًا إلى `HEROES` وأربع قدرات إلى `HERO_ABILITIES` في `src/catalog/heroes.ts`، والقصة إلى `src/catalog/stories.ts`.

قالب فارغ (مثال على البنية فقط، وليس شخصية فعلية):

```ts
// HeroDef
{
  kind: 'hero',
  id: '<hero-id>',            // ثابت للأبد؛ يُحفظ في بيانات المستخدم
  name: '<الاسم>',
  title: '<اللقب>',
  role: 'warrior' | 'mage' | 'assassin' | 'healer' | 'support',
  maxHp: 0,                   // عدد صحيح موجب
  levelImages: [
    'assets/starting-portraits/<hero-id>.png',
    'assets/<pack>/<hero-id>-level-2.png',
    'assets/<pack>/<hero-id>-level-3.png',
    'assets/<pack>/<hero-id>-level-4.png',
    'assets/<pack>/<hero-id>-level-5.png',
  ],
  abilityIds: ['<A1>', '<A2>', '<A3>', '<A4>'], // 4 قدرات بالضبط
  story: STORIES['<hero-id>'],
  flavor: '',
  starter: false,             // false = يظهر في متجر الأبطال بثمنه
  gemPrice: 100,
}

// AbilityDef (بطل)
{
  id: '<A1>', ownerId: '<hero-id>', name: '', cost: 1,
  heroTarget: 'none' | 'ally-any' | 'ally-other',
  effects: [ /* انظر أنواع التأثيرات أدناه */ ],
  targetText: '', displayText: '', note: '', vfxText: '',
  vfx: ['slash'],             // عائلات المؤثرات المشتركة
  image: 'assets/<pack>/<hero-id>-<A1>.png',
}
```

- إذا كان `starter: false` يظهر البطل في **متجر الأبطال** بثمنه، ويبدأ عند الشراء بـ0 انتصار ومستوى تجميلي 1.
- تكرار الدور مسموح لأبطال مختلفين. توزيع الخانات يضع الزائد في أول خانة خالية.

## 3) زعيم جديد
أضف تعريفًا إلى `BOSSES` وتسع قدرات إلى `BOSS_ABILITIES` في `src/catalog/bosses.ts`:

```ts
{
  kind: 'boss', id: '<boss-id>', name: '', title: '', maxHp: 0,
  image: 'assets/starting-portraits/<boss-id>.png',
  bannerPosition: '50% 30%',   // موضع الصورة في بانر القتال
  abilityIds: [/* 9 قدرات بالضبط */],
  phase2Rule: 'lowest-ratio-two' | 'poisoned',
  phase2Text: '', combatStyle: '', story: STORIES['<boss-id>'],
  starter: false,              // false = مقفل حتى يُفتح باستحقاق رتبة
}
// AbilityDef (زعيم): بلا cost، مع bossTarget: 'self' | 'single' | 'double' | 'all'
```

## 4) ربط الزعيم بمكافآت الرتب
في `src/catalog/unlocks.ts` ضع المعرّف في الخانة المناسبة:

```ts
export const rankCompletionRewards = {
  1: ['<boss-id>'],            // خانة واحدة لنهاية الرتبة 1
  4: [null, null],             // خانتان؛ null = لم تُعيَّن بعد
  // ...
};
```

- لا تغيّر عدد الخانات (`BOSS_SLOTS_PER_RANK`): 1،1،1،2،2،2،3،3،3.
- المستخدم الذي أكمل الرتبة قبل إضافة المحتوى لديه استحقاق محفوظ باسم `rank:<r>:<i>`. عند تشغيل الإصدار الجديد تطبّق دالة `reconcileEntitlements` الفتح مرة واحدة. لا يُستهلك الاستحقاق إذا كان المعرّف غير صالح.
- لا تغيّر ترتيب الخانات بعد النشر، لأن الاستحقاق مرتبط برقم الخانة.

## 5) أنواع التأثيرات المدعومة (typed)
`damage` (مع `piercing`، و`bonus`: ifBossBurning / ifTargetShielded / ifTargetPoisoned، و`markBonusOverride`، و`healOwnerOnHit`)، `shield` (مع `reflect`)، `heal`، `cleanse`، `removeBarrier`، `dot` (burn / poison / bleed)، `huntMark`، `expose`، `focus`، `weaken`.

الأهداف المتاحة: `boss`، `owner`، `chosen`، `allHeroes`، `otherHeroes`، `bossTargets`.

كل تأثير يُطبَّق في طبقته حسب القسم 14 من المواصفات (A: التثبيت، B: الحماية والعلاج والتطهير، C: الضرر، D: تحديث الحياة معًا، E: الحالات الجديدة).

**آلية جديدة فعلًا** (مثل استدعاء وحدات، أو تبديل أماكن، أو ضربة حرجة) تحتاج معالجًا جديدًا في `src/engine/battle/engine.ts` واختبارات في `tests/unit/`. ملف JSON لا يستطيع اختراع قاعدة غير مدعومة.

## 6) التحقق
- `buildCatalog()` يتحقق من: تميّز المعرّفات، وصلاحية الأرقام، ووجود الأصول، و4 قدرات لكل بطل و9 لكل زعيم، وتوافق الأهداف. المحتوى غير الصالح يُعزل ويظهر عدده في **الإعدادات ← البيانات**، ولا يتعطل التقدم المحفوظ.
- شغّل `npm test` و`npm run build` و`npm run test:e2e`.
- إذا غيّرت شكل البيانات المحفوظة نفسها، أضف مهاجرة في `DATA_MIGRATIONS` داخل `src/store/db.ts` وارفع `SCHEMA_VERSION`. لا تعِد تهيئة بيانات المستخدم.
