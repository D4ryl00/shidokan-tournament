import type { FfkImportResult } from '../../../domain/ffk-plan/plan.js';
import { plural } from '../../../domain/plural.js';
import type { CategoryGrid } from '../../../domain/types.js';
import type { FfkPreview } from '../../api.js';
import { ageBandLabel, weightClassTitle } from '../../labels.js';
import { lineDisciplines, type PageCardState } from './cardState.js';

/** Une ligne du récapitulatif : un texte, suivi d’une partie en gras (`strong`) ; `validated` : marquée « validée ». */
export interface RecapItem {
  text: string;
  strong?: string;
  validated?: boolean;
}
/** Une rubrique du récapitulatif : titre, puis une liste ou une phrase ; `aside` : ce que l’import laisse de côté. */
export interface RecapBlock {
  title: string;
  items?: RecapItem[];
  note?: string;
  aside?: boolean;
}

/** Club de la compétition, tel que la page le connaît (`useClubs`). */
type RecapClub = { id: string; name: string; ffkEntity: string | null };

/** Combattants laissés de côté par l’import : cartes à trancher ou écartées (le `leftAside` du résultat). */
export const cardsLeftAside = (plan: Pick<FfkPreview, 'cards'>) => plan.cards.filter((c) => c.state === 'todo' || c.state === 'skip');

/**
 * Récapitulatif de « Confirmer l’import FFK », tiré de l’aperçu : ce que l’import appliquera, et ce qu’il laisse de côté (clubs pas
 * reliés à part, puis les combattants avec la raison — leur nombre est celui que donne la notification de fin).
 */
export function recap(plan: FfkPreview, states: Record<string, PageCardState>, grid: CategoryGrid | undefined, clubs: RecapClub[]): RecapBlock[] {
  const blocks: RecapBlock[] = [];
  const name = (l: { lastName: string; firstName: string }) => `${l.lastName} ${l.firstName}`;
  const fighterLabel = (id: string) => plan.fighters.find((f) => f.fighterId === id)?.label ?? '…';
  const club = (id: string) => clubs.find((c) => c.id === id);
  const clubName = (id: string) => club(id)?.name ?? '…';
  const count = (n: number) => n.toLocaleString('fr-FR');

  const created = plan.weightClasses.filter((w) => w.accepted);
  if (created.length) blocks.push({ title: 'Catégories de poids créées', items: created.map((w) => ({ text: weightClassTitle(grid, w) })) });
  // Liens écrits à l’import : choisis, ou sûrs mais pas encore mémorisés sur le club (entité FFK, alias).
  const linked = plan.clubs.filter((c) => c.target && (c.chosen || club(c.target)?.ffkEntity !== c.clubEntity));
  if (linked.length) {
    blocks.push({
      title: 'Clubs reliés ou créés',
      items: linked.map((c) => ({ text: `${c.clubName} → `, strong: `${clubName(c.target!)}${c.chosen ? '' : ' (lien sûr, mémorisé)'}` })),
    });
  }

  const imported = plan.cards.filter((c) => c.state === 'auto' || c.state === 'done');
  const updates = imported.filter((c) => c.fighterId !== 'new' && c.changes.length > 0);
  if (updates.length) {
    blocks.push({
      title: `Inscriptions mises à jour (${count(updates.length)})`,
      items: updates.map((c) => ({ text: `${fighterLabel(c.fighterId!)} — ${lineDisciplines(c.value!.line)} : ${c.changes.join(' ; ')}`, validated: c.state === 'done' })),
    });
  }
  const confirmed = imported.filter((c) => c.fighterId !== 'new' && c.changes.length === 0).length;
  blocks.push({ title: `Confirmées sans changement (${count(confirmed)})`, note: 'Marquées « confirmée FFK ».' });
  const creates = imported.filter((c) => c.fighterId === 'new');
  if (creates.length) {
    blocks.push({
      title: `Combattants créés (${count(creates.length)})`,
      items: creates.map((c) => {
        const l = c.value!.line;
        const age = l.ageBandCode ? ageBandLabel(grid, l.ageBandCode) : '—';
        return { text: `${name(l)} — ${lineDisciplines(l)}, ${age}${c.value!.clubId ? `, ${clubName(c.value!.clubId)}` : ''}` };
      }),
    });
  }
  const deleted = plan.orphans.filter((o) => o.action === 'delete');
  if (deleted.length) blocks.push({ title: `Inscriptions supprimées (${count(deleted.length)})`, items: deleted.map((o) => ({ text: `${o.label} — ${o.disciplines}` })) });
  const kept = plan.orphans.length - deleted.length;
  if (kept) blocks.push({ title: `Fiches club sans inscription FFK gardées (${count(kept)})`, note: 'Gardées telles quelles, sans la marque « confirmée FFK ».' });

  const clubsAside = plan.clubs.filter((c) => !c.target);
  const cardsAside = cardsLeftAside(plan);
  if (clubsAside.length || cardsAside.length) {
    const counts = [...(clubsAside.length ? [plural(clubsAside.length, 'club')] : []), ...(cardsAside.length ? [plural(cardsAside.length, 'combattant')] : [])];
    blocks.push({
      title: `Laissé de côté : ${counts.join(' · ')}`,
      aside: true,
      items: [
        ...clubsAside.map((c) => ({ text: `Club ${c.clubName} : pas relié, ses nouveaux combattants ne sont pas créés` })),
        ...cardsAside.map((c) => {
          const why = c.state === 'skip' ? 'écartée' : states[c.key] === 'pending' ? 'carte modifiée mais pas validée' : (c.reason ?? 'à trancher');
          return { text: `${name(c.exportLine)} — ${lineDisciplines(c.exportLine)} : ${why}` };
        }),
      ],
      note: 'Rien ne change pour eux. Réimportez le même fichier plus tard pour les traiter.',
    });
  }
  return blocks;
}

/** Notification de fin : « Import FFK : 2 combattants créés, …, 3 combattants laissés de côté. » (le même nombre que le récapitulatif). */
export const resultMessage = (r: FfkImportResult) =>
  `Import FFK : ${[
    plural(r.created, 'combattant créé', 'combattants créés'),
    plural(r.updated, 'mis à jour', 'mis à jour'),
    plural(r.deleted, 'supprimé', 'supprimés'),
    plural(r.weightClassesCreated, 'catégorie créée', 'catégories créées'),
    ...(r.leftAside ? [plural(r.leftAside, 'combattant laissé de côté', 'combattants laissés de côté')] : []),
  ].join(', ')}.`;
