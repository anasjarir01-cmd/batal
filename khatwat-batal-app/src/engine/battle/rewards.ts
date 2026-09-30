import type { BattleState } from './types';

/** الأبطال الذين يكسبون +1 انتصار: الخمسة المختارون كلهم عند الفوز فقط، حتى الساقطون. */
export function battleWinners(s: BattleState): string[] {
  return s.outcome === 'victory' ? s.teamHeroIds.slice() : [];
}
