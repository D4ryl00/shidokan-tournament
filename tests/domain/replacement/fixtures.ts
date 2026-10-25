import { keyString, naturalKey } from '../../../src/domain/categories.js';
import { ffkDefaultGrid } from '../../../src/domain/grid-ffk.js';
import type { CategoryState, Member, State } from '../../../src/domain/replacement/types.js';
import { defaultSettings } from '../../../src/domain/settings.js';

let n = 0;
export function member(over: Partial<Member> = {}): Member {
  n++;
  return {
    registrationId: `r${n}`, fighterId: `f${n}`, clubId: `club${n}`, clubPreApproval: false, label: `NOM${n}`,
    sex: 'F', ageBandCode: 'cadet', discipline: 'karate', ruleset: 'jiyu', weightClassId: 'cadet:F:-54',
    weighInKg: null, approxWeightKg: null, presence: 'unknown', otherDisciplines: [], acceptsJiyuFirst: null,
    categoryId: null, placementLocked: false, original: null, recasementType: null, ...over,
  };
}

/** État où chaque membre sans catégorie est placé dans sa catégorie naturelle (créée au besoin). */
export function makeState(members: Member[], over: Partial<State> = {}): State {
  const categories: CategoryState[] = [...(over.categories ?? [])];
  for (const m of members) {
    if (m.categoryId) continue;
    const key = naturalKey(m, m);
    const ks = keyString(key);
    let cat = categories.find((c) => keyString(c.key) === ks || c.aliasKeys.includes(ks));
    if (!cat) {
      cat = { id: `cat:${ks}`, key, status: 'provisional', aliasKeys: [], waveOverride: null };
      categories.push(cat);
    }
    m.categoryId = cat.id;
  }
  return { grid: ffkDefaultGrid(), settings: defaultSettings(), refused: [], waves: [], closedEntries: [], setAside: [], ...over, categories, members };
}
