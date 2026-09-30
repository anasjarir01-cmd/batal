// مولّد أعداد عشوائية قابل للبذر وإعادة الإنتاج. كل غرض له تيار مستقل مشتق من البذرة ومفاتيح ثابتة
// (مثلًا: خلط رزمة الزعيم للدورة c، أهداف الجولة r)، فلا يؤثر اختيار اللاعب في مستقبل الزعيم.

/** cyrb128: تجزئة نصية إلى أربع قيم 32 بت. */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703,
    h2 = 3144134277,
    h3 = 1013904242,
    h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: string) {
    [this.a, this.b, this.c, this.d] = cyrb128(seed);
    for (let i = 0; i < 12; i++) this.nextU32();
  }

  /** sfc32: عدد صحيح 32 بت بلا إشارة. */
  nextU32(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** عدد صحيح متساوي الاحتمال في [0, n) بأخذ العينات مع الرفض (بلا انحياز). */
  int(n: number): number {
    if (!Number.isInteger(n) || n <= 0 || n > 2 ** 32) throw new RangeError('n غير صالح');
    const limit = Math.floor(2 ** 32 / n) * n;
    let x: number;
    do x = this.nextU32();
    while (x >= limit);
    return x % n;
  }

  /** خلط Fisher–Yates: كل ترتيب متساوي الاحتمال. يعيد نسخة جديدة. */
  shuffle<T>(items: readonly T[]): T[] {
    const arr = items.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  pick<T>(items: readonly T[]): T {
    if (!items.length) throw new RangeError('لا عناصر للاختيار');
    return items[this.int(items.length)];
  }
}

export function stream(seed: string, ...keys: Array<string | number>): Rng {
  return new Rng(`${seed}::${keys.join('::')}`);
}

/** بذرة عشوائية حقيقية للمعارك الفعلية. */
export function randomSeed(): string {
  const buf = new Uint32Array(4);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (x) => x.toString(16).padStart(8, '0')).join('');
}
