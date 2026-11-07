/** Types d'actions du journal d'historique de la planche. */
export type HistoryKind = 'plan' | 'reaffectation' | 'manual' | 'exchange' | 'withdraw' | 'places' | 'redraw' | 'format' | 'free';

export const HISTORY_KIND_LABELS: Record<HistoryKind, string> = {
  plan: 'Plan',
  reaffectation: 'Réaffectation',
  manual: 'À la main',
  exchange: 'Échange',
  withdraw: 'Ne combat pas',
  places: 'Places',
  redraw: 'Tirage',
  format: 'Format',
  free: 'Tableau libre',
};

export type HistoryFilter = 'all' | 'plan' | 'manual' | 'tab';

/** Filtre de l'historique auquel appartient un type d'action. */
export function filterOfKind(k: HistoryKind): Exclude<HistoryFilter, 'all'> {
  switch (k) {
    case 'plan':
    case 'reaffectation':
      return 'plan';
    case 'manual':
    case 'exchange':
    case 'withdraw':
      return 'manual';
    case 'places':
    case 'redraw':
    case 'format':
    case 'free':
      return 'tab';
  }
}

/** Types d'actions emportés par « Repartir de zéro ». */
export const RESET_KINDS: HistoryKind[] = ['plan', 'reaffectation', 'manual', 'exchange', 'withdraw'];

export interface HistorySummary {
  registrationIds: string[];
  fromLabel?: string;
  toLabel?: string;
  detail?: string;
  reason?: string;
}

export interface HistoryEntryView {
  id: string;
  seq: number;
  kind: HistoryKind;
  groupId: string | null;
  status: 'active' | 'undone';
  createdAt: string;
  undoneAt: string | null;
  waveId: string | null;
  /** « NOM Prénom » de summary.registrationIds, dans le même ordre. */
  names: string[];
  summary: HistorySummary;
  categoryIds: string[];
  afterMembers: Record<string, string[]>;
  /** Raison si l'action (ou sa cascade) ne peut pas être annulée. */
  blocked: string | null;
  /** Ids des actions plus récentes emportées (sans elle-même), plus récente d'abord. */
  cascade: string[];
}
