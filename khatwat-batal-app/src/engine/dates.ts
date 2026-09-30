// التاريخ المحلي للجهاز. المفتاح يُبنى من مكونات التاريخ المحلي، لا من قص تاريخ UTC،
// ولا يفترض أن اليوم 24 ساعة بالمللي ثانية (التوقيت الصيفي).

export function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** بداية اليوم المحلي التالي (00:00) حسب توقيت الجهاز. */
export function nextLocalMidnight(d: Date = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
}

export function msUntilNextLocalMidnight(d: Date = new Date()): number {
  return Math.max(1000, nextLocalMidnight(d).getTime() - d.getTime());
}

export function formatDateTime(ts: number): string {
  try {
    return new Intl.DateTimeFormat('ar-MA-u-nu-latn', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleString();
  }
}
