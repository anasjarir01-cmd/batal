// خريطة فتح الزعماء عند نهاية الرتب.
// عدد الاستحقاقات لكل رتبة ثابت (1،1،1،2،2،2،3،3،3 = 18). كل خانة تُربط لاحقًا بمعرّف زعيم
// عند إضافة محتواه. الخانة الفارغة (null) تبقى استحقاقًا محفوظًا غير معيّن حتى يُزوَّد المحتوى.
// لا تغيّر ترتيب الخانات بعد النشر: الاستحقاق المحفوظ مرتبط بـ(الرتبة، رقم الخانة).

export const BOSS_SLOTS_PER_RANK: Record<number, number> = {
  1: 1,
  2: 1,
  3: 1,
  4: 2,
  5: 2,
  6: 2,
  7: 3,
  8: 3,
  9: 3,
};

/** rankCompletionRewards[rank][slotIndex] = bossId أو null إن لم يُحدد بعد. */
export const rankCompletionRewards: Record<number, Array<string | null>> = {
  1: [null],
  2: [null],
  3: [null],
  4: [null, null],
  5: [null, null],
  6: [null, null],
  7: [null, null, null],
  8: [null, null, null],
  9: [null, null, null],
};
