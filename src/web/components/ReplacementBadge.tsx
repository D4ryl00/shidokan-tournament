import { Badge, Popover, Stack, Text, UnstyledButton } from '@mantine/core';
import { useMemo } from 'react';
import type { ProposalType } from '../../domain/replacement/index.js';
import { useReplacement, type RecasementEntry } from '../api.js';

/** Couleur = nature du changement (5 couleurs + gris), icône + texte : jamais la couleur seule. */
export const PROPOSAL_TYPES: Record<ProposalType, { color: string; label: string; simple: boolean; title: string }> = {
  A: { color: 'blue', label: '⚖ Poids', simple: true, title: 'Catégorie de poids voisine (dans l’écart autorisé)' },
  B: { color: 'blue', label: '⚖ Poids +', simple: false, title: 'Catégorie de poids voisine, écart au-delà du seuil' },
  C: { color: 'orange', label: '↑ Âge', simple: false, title: 'Tranche d’âge au-dessus' },
  D: { color: 'orange', label: '⇄ Sen./Vét.', simple: false, title: 'Mélange seniors / vétérans' },
  E: { color: 'orange', label: '↑ Min./Adultes', simple: false, title: 'Mélange mineurs / adultes' },
  F: { color: 'pink', label: '⚥ Mixte', simple: false, title: 'Mélange filles / garçons' },
  G: { color: 'cyan', label: 'Shobu → Jiyu', simple: false, title: 'Passage du shobu au jiyu' },
  H: { color: 'grape', label: '⇄ Discipline', simple: false, title: 'Autre discipline (préférences du combattant)' },
  R: { color: 'gray', label: '↩ Retour', simple: true, title: 'Retour dans la catégorie d’origine' },
  M: { color: 'gray', label: '✋ Manuel', simple: false, title: 'Déplacement manuel de l’organisateur' },
};

const kg = (x: number) => `${Number(x.toFixed(1)).toString().replace('.', ',')} kg`;

/** Dernier recasement validé de chaque inscription (détail des badges). */
export function useRecasementDetails(competitionId: string): Map<string, RecasementEntry> {
  const { data } = useReplacement(competitionId);
  return useMemo(() => {
    const out = new Map<string, RecasementEntry>();
    // Les entrées arrivent de la plus récente à la plus ancienne.
    for (const r of data?.recasements ?? []) if (r.status === 'validated' && !out.has(r.registrationId)) out.set(r.registrationId, r);
    return out;
  }, [data]);
}

/**
 * Contour = proposé, plein = validé, grisé = refusé ou annulé.
 * `gapKg` : écart de poids affiché sur les badges « ⚖ Poids » ; `detail` : origine, arrivée, motif et heure au clic.
 */
export function ReplacementBadge({ type, state = 'validated', size = 'sm', gapKg, detail }: {
  type: ProposalType;
  state?: 'proposed' | 'validated' | 'refused';
  size?: 'xs' | 'sm' | 'md';
  gapKg?: number;
  detail?: RecasementEntry;
}) {
  const t = PROPOSAL_TYPES[type];
  const badge = (
    <Badge
      data-testid="replacement-badge"
      data-state={state}
      size={size}
      color={state === 'refused' ? 'gray' : t.color}
      variant={state === 'validated' ? 'filled' : 'outline'}
      title={detail ? `${t.title} — cliquer pour le détail` : t.title}
      style={{ ...(state === 'refused' ? { textDecoration: 'line-through', opacity: 0.6 } : {}), ...(detail ? { cursor: 'pointer' } : {}) }}
    >
      {t.label}{gapKg !== undefined && (type === 'A' || type === 'B') ? ` ${kg(gapKg)}` : ''}
    </Badge>
  );
  if (!detail) return badge;
  return (
    <Popover withArrow shadow="md" width={320} position="bottom-start">
      <Popover.Target>
        <UnstyledButton component="span" onClick={(e) => e.stopPropagation()} aria-label={`Détail de la réaffectation : ${t.title}`}>{badge}</UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown data-testid="recasement-detail">
        <Stack gap={4}>
          <Text size="sm" fw={600}>{t.title}</Text>
          <Text size="xs"><b>Origine :</b> {detail.fromLabel}</Text>
          <Text size="xs"><b>Arrivée :</b> {detail.toLabel}</Text>
          {detail.reason && <Text size="xs"><b>Motif :</b> {detail.reason}</Text>}
          <Text size="xs" c="dimmed">
            {new Date(detail.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · {detail.bulk ? 'en masse' : 'unitaire'}
            {detail.preApproved ? ' · pré-accord coach' : ''}
          </Text>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
