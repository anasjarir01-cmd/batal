// أنواع الكتالوج الثابت: الشخصيات والقدرات وأوصاف التأثيرات المكتوبة (typed).
// محرك القتال يقرأ هذه الأوصاف فقط؛ النص العربي للعرض ولا يُحلَّل أثناء اللعب.

export type Role = 'warrior' | 'mage' | 'assassin' | 'healer' | 'support';

/** ترتيب خانات الأدوار الثابت من اليمين إلى اليسار. */
export const ROLE_SLOT_ORDER: readonly Role[] = ['warrior', 'mage', 'assassin', 'healer', 'support'];

export const ROLE_LABEL: Record<Role, string> = {
  warrior: 'المحارب',
  mage: 'الساحر',
  assassin: 'القاتل',
  healer: 'المعالج',
  support: 'المساند',
};

/**
 * اختيار الهدف الذي يطلبه اللاعب عند التخطيط لقدرة بطل.
 * none: لا اختيار (الزعيم/النفس/الجميع).
 * ally-any: بطل حي واحد ويجوز صاحب البطاقة.
 * ally-other: حليف آخر حي؛ صاحب البطاقة ممنوع.
 */
export type HeroTargetChoice = 'none' | 'ally-any' | 'ally-other';

/** اختيار أهداف الزعيم عند بداية الجولة. */
export type BossTargetChoice = 'self' | 'single' | 'double' | 'all';

/** على من يقع جزء التأثير. */
export type EffectTarget =
  | 'boss' // الزعيم (من بطاقة بطل)
  | 'owner' // صاحب البطاقة (بطل أو زعيم)
  | 'chosen' // البطل الذي اختاره اللاعب
  | 'allHeroes' // كل الأبطال الأحياء عند بداية الخانة
  | 'otherHeroes' // كل الأبطال الأحياء عدا صاحب البطاقة
  | 'bossTargets'; // أهداف الزعيم المحددة عند بداية الجولة

export type DamageBonus =
  | { kind: 'ifBossBurning'; amount: number; consumeBurn: true } // N4
  | { kind: 'ifTargetShielded'; amount: number } // F6 (يرى الصدّ الجديد)
  | { kind: 'ifTargetPoisoned'; amount: number }; // Y9 (بعد التطهير الفوري)

export type Effect =
  | {
      type: 'damage';
      target: EffectTarget;
      amount: number;
      piercing?: boolean;
      bonus?: DamageBonus;
      /** S4: مقدار العلامة البديل عند استهلاكها (بدل قيمتها العادية). */
      markBonusOverride?: number;
      /** Y6: علاج صاحب البطاقة إذا بقي ضرر مباشر موجب بعد الإضعاف والصدّ. */
      healOwnerOnHit?: number;
    }
  | { type: 'shield'; target: EffectTarget; amount: number; reflect?: number }
  | { type: 'heal'; target: EffectTarget; amount: number }
  | { type: 'cleanse'; target: EffectTarget; remove: Array<'poison' | 'bleed' | 'burn' | 'weaken'> }
  | { type: 'removeBarrier'; target: EffectTarget }
  | { type: 'dot'; target: EffectTarget; status: 'burn' | 'poison' | 'bleed'; amount: number; ticks: number }
  | { type: 'huntMark'; target: EffectTarget; amount: number }
  | { type: 'expose'; target: EffectTarget; amount: number; charges: number }
  | { type: 'focus'; target: EffectTarget; amount: number }
  | { type: 'weaken'; target: EffectTarget; amount: number };

export type EffectType = Effect['type'];

/** عائلات المؤثرات البصرية المشتركة. */
export type VfxFamily =
  | 'slash'
  | 'claw'
  | 'bite'
  | 'arrow'
  | 'arrow-pierce'
  | 'fire'
  | 'sun'
  | 'shield'
  | 'barrier-break'
  | 'heal'
  | 'cleanse'
  | 'buff'
  | 'debuff'
  | 'mark'
  | 'expose'
  | 'poison'
  | 'bleed'
  | 'mirror'
  | 'quake'
  | 'howl'
  | 'thread';

export interface AbilityDef {
  id: string;
  ownerId: string;
  name: string;
  /** كلفة الطاقة للأبطال فقط. */
  cost?: number;
  heroTarget?: HeroTargetChoice;
  bossTarget?: BossTargetChoice;
  effects: Effect[];
  /** نص الهدف كما في المواصفات. */
  targetText: string;
  /** الأثر الدقيق كما في المواصفات. */
  displayText: string;
  /** التوضيح. */
  note?: string;
  /** وصف المؤثر البصري. */
  vfxText: string;
  vfx: VfxFamily[];
  /** مسار الصورة الأصلية داخل assets/. */
  image: string;
}

export interface HeroDef {
  kind: 'hero';
  id: string;
  name: string;
  title: string;
  role: Role;
  maxHp: number;
  /** صور المستويات التجميلية 1..5 (المستوى 1 = الصورة الأساسية). */
  levelImages: [string, string, string, string, string];
  abilityIds: string[];
  story: string[];
  flavor: string;
  /** مملوك مجانًا في أول تشغيل. */
  starter: boolean;
  /** ثمن الشراء بالجواهر إن لم يكن مملوكًا. */
  gemPrice: number;
}

export type Phase2Rule = 'lowest-ratio-two' | 'poisoned';

export interface BossDef {
  kind: 'boss';
  id: string;
  name: string;
  title: string;
  maxHp: number;
  image: string;
  /** موضع الصورة داخل بانر القتال (CSS object-position). */
  bannerPosition: string;
  abilityIds: string[];
  phase2Rule: Phase2Rule;
  phase2Text: string;
  combatStyle: string;
  story: string[];
  /** مفتوح من البداية. */
  starter: boolean;
}

export type CharacterDef = HeroDef | BossDef;
