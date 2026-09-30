// ألوان الأدوار في الساحة: تُطبَّق بالدور لا بالبطل، فكل بطل جديد يأخذ لون دوره تلقائيًا.
// الألوان نفسها معرّفة في arena.css على الأصناف role-*؛ هذا الملف يحدد الصنف فقط.
import { CATALOG } from '../../catalog';
import type { Role } from '../../catalog/types';

export type Tint = Role | 'boss' | 'hidden';

/** لون إطار بطاقة قدرة: دور صاحبها إن كان بطلًا، وقرمزي إن كانت للزعيم. */
export function abilityTint(abilityId: string): Tint {
  const a = CATALOG.abilities.get(abilityId);
  const hero = a ? CATALOG.heroById.get(a.ownerId) : undefined;
  return hero ? hero.role : 'boss';
}

export function heroTint(heroId: string): Tint {
  return CATALOG.heroById.get(heroId)?.role ?? 'warrior';
}

export function tintClass(t: Tint): string {
  return `role-${t}`;
}
