import { useState } from 'react';
import { hashKey, keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import type { Competition, CompetitionInput } from '../domain/competition.js';
import type { BracketFormat, KataScores, MatchMethod, Podium } from '../domain/brackets/index.js';
import type { CategoryProgress, MedalRow, ResultRecord } from '../domain/results.js';
import type { Category, CategoryStatus } from '../domain/categories.js';
import type { ClubFormHeader, ClubFormLine, ClubFormParse } from '../domain/club-form.js';
import type { ClosedCategoriesView, EntryCell } from '../domain/closed-categories.js';
import type { ColumnMapping, FfkChoices, FfkImportPlan } from '../domain/ffk-import.js';
import type { Club, DirectoryEntry, DirectoryInput, RegistrationInput, RegistrationRow } from '../domain/registration.js';
import type { Case, Presence, Proposal, ProposalType } from '../domain/replacement/index.js';
import type { CategoryGrid, DisciplineId } from '../domain/types.js';
import type { LadderProgress, LadderRow, PlanChoice, PlanMove } from '../domain/replacement/plan.js';
import { fetchPlanStream } from './planStream.js';
import { applyRulesView, type RulesView } from '../domain/replacement/rules.js';
import type { Wave, WaveInput } from '../domain/waves.js';
import type { AppSettingsPatch, PublicAppSettings } from '../domain/app-settings.js';
import type { GoogleContactsView, SyncApply } from '../domain/google-contacts.js';
import type { Zone, ZoneInput } from '../domain/zones.js';
import type { PassagePlan } from '../domain/passages/index.js';

import { ApiError, TAB_ID } from './apiError.js';
export { ApiError, TAB_ID };

/** `rev` : révision de la donnée telle que l'écran l'a lue (null : elle n'existait pas) ; envoyée en If-Match. */
export async function api<T>(method: string, url: string, body?: unknown, opts: { rev?: string | null } = {}): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(opts.rev === undefined ? {} : { 'If-Match': opts.rev ?? 'none' }),
      ...(method === 'GET' ? {} : { 'X-Poste-Id': TAB_ID }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; issues?: string[]; code?: string };
    throw new ApiError(res.status, data.error ?? `Erreur ${res.status}`, data.issues ?? [], data.code);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const useCompetitions = () =>
  useQuery({ queryKey: ['competitions'], queryFn: () => api<CompetitionListItem[]>('GET', '/api/competitions') });

/** Une compétition de la liste de l'accueil : en plus, le nombre d'inscrits et l'état de la main. */
export type CompetitionListItem = Competition & { registrationCount: number; management: { managedHere: boolean; ownerName: string | null; deletable: boolean } };

export const useCompetition = (id: string) =>
  useQuery({ queryKey: ['competitions', id], queryFn: () => api<Competition>('GET', `/api/competitions/${id}`) });

export function useCreateCompetition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CompetitionInput & { templateId?: string }) => api<Competition>('POST', '/api/competitions', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['competitions'] }),
  });
}

export function useDeleteCompetition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api<void>('DELETE', `/api/competitions/${id}`, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['competitions'] }),
  });
}

export function useUpdateCompetition(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<CompetitionInput> & { settings?: unknown }) =>
      api<Competition>('PATCH', `/api/competitions/${id}`, patch),
    onSuccess: (c) => {
      qc.setQueryData(['competitions', id], c);
      // Les réglages changent les tableaux et l'ordre de passage.
      return Promise.all(['competitions', ['categories', id], ['schedule', id]].map((k) => qc.invalidateQueries({ queryKey: Array.isArray(k) ? k : [k] })));
    },
  });
}

export const useGrid = (id: string) =>
  useQuery({ queryKey: ['grid', id], queryFn: () => api<CategoryGrid>('GET', `/api/competitions/${id}/grid`) });

export function useReplaceGrid(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (grid: CategoryGrid) => api<void>('PUT', `/api/competitions/${id}/grid`, grid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['grid', id] });
      qc.invalidateQueries({ queryKey: ['closed-categories', id] });
    },
  });
}

export function useSetClosedCategories(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { cells: EntryCell[]; closed: boolean }) => api<void>('PUT', `/api/competitions/${id}/closed-categories`, body),
    onSuccess: () => {
      for (const key of ['closed-categories', 'replacement', 'categories']) qc.invalidateQueries({ queryKey: [key, id] });
    },
  });
}

export const useClosedCategories = (id: string) =>
  useQuery({ queryKey: ['closed-categories', id], queryFn: () => api<ClosedCategoriesView>('GET', `/api/competitions/${id}/closed-categories`) });

// --- Clubs, inscriptions, fiche club (étape 2) ---

export function useClubs(id: string) {
  return useQuery({ queryKey: ['clubs', id], queryFn: () => api<Club[]>('GET', `/api/competitions/${id}/clubs`) });
}

export function useUpsertClub(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Club> & { name: string }) => api<Club>('POST', `/api/competitions/${id}/clubs`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clubs', id] }),
  });
}

export function useUpdateClub(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clubId, ...patch }: Partial<Club> & { clubId: string }) =>
      api<Club>('PATCH', `/api/competitions/${id}/clubs/${clubId}`, patch),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['clubs', id] }), qc.invalidateQueries({ queryKey: ['registrations', id] })]),
  });
}

export function useRegistrations(id: string) {
  return useQuery({ queryKey: ['registrations', id], queryFn: () => api<RegistrationRow[]>('GET', `/api/competitions/${id}/registrations`) });
}

function useInvalidateRegistrations(id: string) {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ['registrations', id] }), qc.invalidateQueries({ queryKey: ['clubs', id] })]);
}

export function useCreateRegistration(id: string) {
  const invalidate = useInvalidateRegistrations(id);
  return useMutation({
    mutationFn: (input: RegistrationInput) =>
      api<{ row: RegistrationRow; warning: string | null }>('POST', `/api/competitions/${id}/registrations`, input),
    onSuccess: invalidate,
  });
}

export function useUpdateRegistration(id: string) {
  const invalidate = useInvalidateRegistrations(id);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rid, input, rev }: { rid: string; input: RegistrationInput; rev?: string }) =>
      api<RegistrationRow & { warning: string | null }>('PUT', `/api/competitions/${id}/registrations/${rid}`, input, { rev: rev ?? registrationRevOf(qc, id, rid) }),
    onSuccess: invalidate,
  });
}

export function useDeleteRegistration(id: string) {
  const invalidate = useInvalidateRegistrations(id);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rid: string) => api<void>('DELETE', `/api/competitions/${id}/registrations/${rid}`, undefined, { rev: registrationRevOf(qc, id, rid) }),
    onSuccess: invalidate,
  });
}

async function upload<T>(url: string, file: File): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: await file.arrayBuffer() });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; issues?: string[] };
    throw new ApiError(res.status, data.error ?? `Erreur ${res.status}`, data.issues ?? []);
  }
  return (await res.json()) as T;
}

export function usePreviewClubForm(id: string) {
  return useMutation({
    mutationFn: (file: File) => upload<ClubFormPreview>(`/api/competitions/${id}/club-forms/preview`, file),
  });
}

export type ClubFormPreview = ClubFormParse & { removals: { registrationId: string; label: string }[] };
export type PaperEntry = { header: ClubFormHeader; lines: ClubFormLine[] };

export function usePreviewPaperEntry(id: string) {
  return useMutation({ mutationFn: (entry: PaperEntry) => api<ClubFormPreview>('POST', `/api/competitions/${id}/club-forms/entry/preview`, entry) });
}

export function useImportPaperEntry(id: string) {
  const invalidate = useInvalidateRegistrations(id);
  return useMutation({
    mutationFn: (entry: PaperEntry) =>
      api<{ club: Club; imported: number; replaced: number; skipped: number }>('POST', `/api/competitions/${id}/club-forms/entry/import`, entry),
    onSuccess: invalidate,
  });
}

export function useImportClubForm(id: string) {
  const invalidate = useInvalidateRegistrations(id);
  return useMutation({
    mutationFn: (file: File) =>
      upload<{ club: Club; imported: number; replaced: number; skipped: number }>(`/api/competitions/${id}/club-forms/import`, file),
    onSuccess: invalidate,
  });
}

// --- Import FFK (étape 3) ---

export interface FfkSheetSetup {
  name: string;
  headerRow: number;
  headers: string[];
  mapping: ColumnMapping;
  include: boolean;
}

export function useUploadFfk(id: string) {
  return useMutation({
    mutationFn: async (file: File) => {
      const res = await fetch(`/api/competitions/${id}/ffk-imports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
        body: await file.arrayBuffer(),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; issues?: string[] };
        throw new ApiError(res.status, data.error ?? `Erreur ${res.status}`, data.issues ?? []);
      }
      return (await res.json()) as { uploadId: string; sheets: FfkSheetSetup[] };
    },
  });
}

export function usePreviewFfk(id: string) {
  return useMutation({
    mutationFn: ({ uploadId, sheets, choices }: { uploadId: string; sheets: FfkSheetSetup[]; choices: FfkChoices }) =>
      api<FfkImportPlan & { fingerprint: string }>('POST', `/api/competitions/${id}/ffk-imports/${uploadId}/preview`, { sheets, choices }),
  });
}

export function useCommitFfk(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ uploadId, sheets, choices, fingerprint }: { uploadId: string; sheets: FfkSheetSetup[]; choices: FfkChoices; fingerprint?: string }) =>
      api<{ created: number; updated: number; removed: number; weightClassesCreated: number }>(
        'POST',
        `/api/competitions/${id}/ffk-imports/${uploadId}/commit`,
        { sheets, choices, fingerprint },
      ),
    onSuccess: () =>
      Promise.all(['registrations', 'clubs', 'grid'].map((k) => qc.invalidateQueries({ queryKey: [k, id] }))),
  });
}

// --- Catégories et tableaux (étape 4) ---

export function useCategories(id: string) {
  return useQuery({ queryKey: ['categories', id], queryFn: () => api<Category[]>('GET', `/api/competitions/${id}/categories`) });
}

function useCategoryMutation<T>(id: string, fn: (arg: T, qc: QC) => Promise<Category>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (arg: T) => fn(arg, qc),
    onSuccess: (updated) => {
      // Nouvelle révision tout de suite en cache : un second clic rapide ne passe pas pour une écriture périmée.
      qc.setQueryData<Category[]>(['categories', id], (list) => list?.map((c) => (c.id === updated.id ? updated : c)));
      return Promise.all(['categories', 'schedule'].map((k) => qc.invalidateQueries({ queryKey: [k, id] })));
    },
  });
}

export const useUpdateCategory = (id: string) =>
  useCategoryMutation(id, ({ cid, ...patch }: { cid: string; format?: BracketFormat | null; repechage?: boolean | null; thirdPlace?: boolean | null; status?: CategoryStatus; unlock?: boolean; zoneId?: string | null; waveOverride?: string | null; order?: number }, qc) =>
    api<Category>('PATCH', `/api/competitions/${id}/categories/${cid}`, patch, { rev: categoryRevOf(qc, id, cid) }),
  );
export const useRedraw = (id: string) =>
  useCategoryMutation(id, (cid: string, qc) => api<Category>('POST', `/api/competitions/${id}/categories/${cid}/redraw`, undefined, { rev: categoryRevOf(qc, id, cid) }));
export const useSwap = (id: string) =>
  useCategoryMutation(id, ({ cid, a, b }: { cid: string; a: string; b: string }, qc) =>
    api<Category>('POST', `/api/competitions/${id}/categories/${cid}/swap`, { a, b }, { rev: categoryRevOf(qc, id, cid) }));

// --- Pesée et recasement (étape 5) ---

export interface WeighInFighter {
  fighterId: string;
  label: string;
  club: string;
  sex: 'M' | 'F';
  ageBandCode: string;
  presence: Presence;
  weighInKg: number | null;
  registrations: { id: string; discipline: DisciplineId; hasWeight: boolean; weightClassLabel: string | null; weighInClassLabel: string | null; outOfClass: boolean; recased: boolean; categoryLabel: string | null; categoryOrder: number | null }[];
}

/** Liste de pesée ; `waveId` : celle d'une vague (sans vague : toute la compétition). */
export function useWeighIn(id: string, waveId?: string | null) {
  return useQuery({
    queryKey: ['weigh-in', id, waveId ?? null],
    queryFn: () => api<{ closed: boolean; fighters: WeighInFighter[] }>('GET', `/api/competitions/${id}/weigh-in${waveId ? `?vague=${encodeURIComponent(waveId)}` : ''}`),
  });
}

/** Premier élément de la clé des requêtes du plan (`usePlan`). */
export const PLAN_KEY = 'replacement-plan';

/**
 * Pesée et recasement changent les catégories, les vagues, l'ordre de passage… : toutes les données de la compétition sont rechargées.
 * Les calculs du plan en cours sont d'abord arrêtés : ils dataient d'avant l'écriture, et un calcul encore sans résultat ne serait
 * pas relancé par la seule invalidation (TanStack ne réutilise alors que la demande en cours). Ce n'est pas une annulation de
 * l'organisateur (« Annuler le calcul ») : le plan est aussitôt recalculé.
 */
function useInvalidateDay(id: string) {
  const qc = useQueryClient();
  return async () => {
    await qc.cancelQueries({ queryKey: [PLAN_KEY, id] });
    return qc.invalidateQueries({ predicate: (q) => q.queryKey[1] === id });
  };
}

export function useSetWeighIn(id: string) {
  const invalidate = useInvalidateDay(id);
  return useMutation({
    mutationFn: ({ fighterId, ...data }: { fighterId: string; presence?: Presence; weighInKg?: number | null; waveId?: string }) =>
      api<void>('PUT', `/api/competitions/${id}/weigh-in/${fighterId}`, data),
    onSuccess: invalidate,
  });
}

export function useCloseWeighIn(id: string) {
  const invalidate = useInvalidateDay(id);
  return useMutation({
    mutationFn: (waveId?: string) => api<{ markedAbsent: number }>('POST', `/api/competitions/${id}/weigh-in/close`, waveId ? { waveId } : undefined),
    onSuccess: invalidate,
  });
}

export interface RecasementEntry {
  id: string;
  registrationId: string;
  type: ProposalType;
  fromLabel: string;
  toLabel: string;
  reason: string;
  manual: boolean;
  preApproved: boolean;
  bulk: boolean;
  status: 'validated' | 'undone';
  createdAt: string;
}
/** Ce qu'il faut savoir d'un combattant à recaser. */
export interface CaseFighter {
  sex: 'M' | 'F';
  ageBandCode: string;
  discipline: DisciplineId;
  ruleset: 'jiyu' | 'shobu' | null;
  weightClassId: string | null;
  weighInKg: number | null;
  approxWeightKg: number | null;
  otherDisciplines: DisciplineId[];
  acceptsJiyuFirst: boolean | null;
  presence: Presence;
}
export interface ReplacementData {
  cases: Case[];
  /** Par inscription d'un cas. */
  fighters: Record<string, CaseFighter>;
  /** Par cas : catégories où le déplacer à la main, avec les règles enfreintes (aucune : déplacement cohérent). */
  moveTargets: Record<string, { categoryId: string; warnings: string[] }[]>;
  /** Les propositions refusées suivent les autres, marquées `refused`. */
  proposals: Record<string, (Proposal & { refused?: true })[]>;
  /** Cartes mises de côté (de la session affichée), avec leur note. */
  setAside: Record<string, { note: string; createdAt: string }>;
  summary: { present: number; absent: number; unknown: number; cases: number; setAside: number; closed: number; alone: number; withoutProposal: number; readyCategories: number; startedCategories: number };
  fingerprint: string;
  recasements: RecasementEntry[];
  /** Historique, refus ou carte de côté dans toute la compétition : « Repartir de zéro » a quelque chose à défaire. */
  resettable: boolean;
}
export interface PreviewData {
  steps: { proposal: Proposal; manual: boolean }[];
  categories: { label: string; before: string[][]; after: string[][] }[];
  unresolved?: number;
  /** Déplacement manuel : règles enfreintes. */
  warnings?: string[];
}

/** Tableau de bord du recasement ; avec une vague, ses cas et ses compteurs seulement. */
export function useReplacement(id: string, waveId?: string | null, enabled = true) {
  return useQuery({
    queryKey: ['replacement', id, waveId ?? null],
    queryFn: () => api<ReplacementData>('GET', `/api/competitions/${id}/replacement${waveId ? `?vague=${encodeURIComponent(waveId)}` : ''}`),
    enabled,
  });
}
export function usePreviewReplacement(id: string) {
  return useMutation({
    mutationFn: (body: { proposalId: string } | { move: { registrationId: string; categoryId: string } }) =>
      api<PreviewData>('POST', `/api/competitions/${id}/replacement/preview`, body),
  });
}
function useReplacementAction<T>(id: string, path: string) {
  const invalidate = useInvalidateDay(id);
  // En cas d'erreur (situation périmée…), les données sont rechargées aussi.
  return useMutation({ mutationFn: (body: T) => api<{ warnings?: string[]; applied?: number }>('POST', `/api/competitions/${id}/replacement/${path}`, body), onSuccess: invalidate, onError: invalidate });
}
export const useApplyProposal = (id: string) => useReplacementAction<{ proposalId: string; fingerprint: string }>(id, 'apply');
export const useRefuseProposal = (id: string) => useReplacementAction<{ proposalId: string }>(id, 'refuse');
export const useUnrefuseProposal = (id: string) => useReplacementAction<{ proposalId: string }>(id, 'unrefuse');
export const useUndoRecasement = (id: string) => useReplacementAction<{ recasementId: string }>(id, 'undo');
export const useManualMove = (id: string) => useReplacementAction<{ registrationId: string; categoryId: string }>(id, 'move');
export const useSetAsideCase = (id: string) => useReplacementAction<{ caseId: string; note?: string }>(id, 'set-aside');
export const useResumeCase = (id: string) => useReplacementAction<{ caseId: string }>(id, 'resume');
export const useWithdrawRegistration = (id: string) => useReplacementAction<{ registrationId: string; fingerprint: string }>(id, 'withdraw');
export const useResetReplacement = (id: string) => useReplacementAction<Record<string, never>>(id, 'reset');

export type { LadderProgress, LadderRow, PlanChoice, PlanMove, RulesView };
/** Réponse de `POST /replacement/plan` (voir `planResponse`, côté serveur). */
export interface PlanResponse {
  view: RulesView;
  rows: LadderRow[];
  plan: {
    moves: PlanMove[];
    aloneBefore: number;
    alone: string[];
    onCards: string[];
    dropped: PlanChoice[];
    /** Pour appliquer : choix validés qui attendent un déplacement à valider non validé. */
    waiting: PlanChoice[];
    proven: boolean;
    hash: string;
    refused: { proposalId: string; registrationId: string; reason: string }[];
  };
  categories?: PreviewData['categories'];
  fingerprint: string;
}
const planBody = (waveId: string | null, choices: PlanChoice[]) => ({ ...(waveId ? { waveId } : {}), choices });

/** Plans (clé hachée) qu'une mise à jour en direct a trouvés en plein calcul : un seul nouveau calcul part à la fin de celui-ci. */
const refreshAfterPlan = new Set<string>();
/** Calcul en cours par plan (clé hachée) : un calcul arrêté, qui finit après celui qui le remplace, ne touche plus à la marque. */
const currentPlanRun = new Map<string, symbol>();

/**
 * Mise à jour en direct (un autre poste a écrit, ou retour sur l'onglet) des plans : un calcul en cours n'est pas relancé (il
 * repartirait de zéro à chaque écriture d'ailleurs), un seul nouveau calcul part quand il finit ; un plan annulé (`meta.cancelledAt`)
 * est seulement marqué périmé — seuls un geste de ce poste ou « Relancer le calcul » le relancent ; les autres sont relus.
 */
export function refreshPlansLive(qc: QueryClient): void {
  for (const q of qc.getQueryCache().findAll({ queryKey: [PLAN_KEY] })) {
    if (q.state.fetchStatus === 'fetching') refreshAfterPlan.add(q.queryHash);
    else if (q.meta?.cancelledAt === q.state.dataUpdatedAt) q.invalidate();
    else void qc.invalidateQueries({ queryKey: q.queryKey, exact: true });
  }
}

/** Un calcul du plan suivi par `refreshPlansLive` : s'il a reçu une mise à jour en direct, il est relancé une fois, à la fin. */
export async function trackPlanFetch<T>(qc: QueryClient, queryKey: QueryKey, signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  const hash = hashKey(queryKey);
  const me = Symbol(hash);
  currentPlanRun.set(hash, me);
  // Ce calcul lit l'état à jour : les mises à jour arrivées avant lui sont prises en compte.
  refreshAfterPlan.delete(hash);
  try {
    return await run();
  } finally {
    // Un calcul plus récent sur la même clé garde la marque (l'arrêt d'un fetch se règle après le départ du suivant).
    if (currentPlanRun.get(hash) === me) {
      currentPlanRun.delete(hash);
      // Arrêté (annulation, geste qui relance, page quittée) : rien à relancer, le calcul suivant lira l'état à jour.
      if (refreshAfterPlan.delete(hash) && !signal.aborted) setTimeout(() => void qc.invalidateQueries({ queryKey, exact: true }), 0);
    }
  }
}

/**
 * Le diagramme des règles et le plan de la ligne de coupure ; rafraîchi par toute action de réaffectation (`queryKey[1]` = compétition).
 * Le calcul se fait à part côté serveur : `progress` donne son avancement, `cancel()` l'arrête (le plan affiché ne tient alors
 * plus compte du dernier changement : `cancelled`), `restart()` le relance. Changer de choix annule le calcul précédent ; les mises
 * à jour en direct suivent `refreshPlansLive`.
 */
export function usePlan(id: string, waveId: string | null, choices: PlanChoice[], enabled: boolean) {
  const qc = useQueryClient();
  // L'avancement porte la clé du calcul : celui d'un calcul abandonné ne s'affiche jamais pour le suivant.
  const [progress, setProgress] = useState<{ key: string; p: LadderProgress | null } | null>(null);
  const queryKey = [PLAN_KEY, id, waveId, choices];
  const keyText = JSON.stringify(queryKey);
  const [cancelledAt, setCancelledAt] = useState<{ key: string; updatedAt: number } | null>(null);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => {
      setProgress({ key: keyText, p: null });
      return trackPlanFetch(qc, queryKey, signal, () =>
        fetchPlanStream(`/api/competitions/${id}/replacement/plan`, planBody(waveId, choices), {
          signal,
          onProgress: (p) => { if (!signal.aborted) setProgress({ key: keyText, p }); },
        }));
    },
    enabled,
    placeholderData: keepPreviousData,
    // Les événements des autres postes et les gestes le tiennent à jour : un calcul au retour sur l'onglet serait du travail perdu.
    refetchOnWindowFocus: false,
    // Lu par `refreshPlansLive` : le plan affiché date de cette annulation.
    meta: { cancelledAt: cancelledAt?.key === keyText ? cancelledAt.updatedAt : null },
  });
  // Annulé tant qu'aucun calcul complet n'est arrivé pour ce même choix (le plan affiché date d'avant l'annulation).
  const cancelled = cancelledAt?.key === keyText && cancelledAt.updatedAt === query.dataUpdatedAt && !query.isFetching;
  return {
    ...query,
    progress: query.isFetching && progress?.key === keyText ? progress.p : null,
    cancelled,
    cancel: () => { setCancelledAt({ key: keyText, updatedAt: query.dataUpdatedAt }); void qc.cancelQueries({ queryKey }); },
    restart: () => { setCancelledAt(null); void query.refetch(); },
  };
}
/** Le plan à appliquer (sans validation) et son aperçu ; `signal` annule le calcul (fermeture de la confirmation). */
export function usePlanForApply(id: string) {
  return useMutation({
    mutationFn: ({ waveId, choices, signal }: { waveId?: string | null; choices: PlanChoice[]; signal?: AbortSignal }) =>
      fetchPlanStream(`/api/competitions/${id}/replacement/plan`, { ...planBody(waveId ?? null, choices), forApply: true }, { signal }),
  });
}
export const useApplyPlan = (id: string) => useReplacementAction<{ waveId?: string; choices: PlanChoice[]; fingerprint: string; hash: string }>(id, 'plan/apply');
/**
 * La liste des règles enregistrée (réponse du serveur) est mise tout de suite dans la compétition, et le recalcul n'est pas attendu :
 * l'écran montre le nouvel état aussitôt, le geste suivant part de la liste enregistrée (aucune écriture perdue) et relance le
 * calcul (celui en cours est annulé).
 */
function useSaveRules<V>(id: string, save: (v: V) => Promise<RulesView>) {
  const qc = useQueryClient();
  const invalidate = useInvalidateDay(id);
  return useMutation({
    mutationFn: save,
    onSuccess: (view: RulesView) => {
      qc.setQueryData<Competition>(['competitions', id], (c) => c && { ...c, settings: applyRulesView(c.settings, view) });
      void invalidate();
    },
  });
}
export const useSetRules = (id: string) => useSaveRules(id, (view: RulesView) => api<RulesView>('PUT', `/api/competitions/${id}/replacement/rules`, view));
export const useResetRules = (id: string) => useSaveRules<void>(id, () => api<RulesView>('POST', `/api/competitions/${id}/replacement/rules/reset`));

// --- Jour J (étape 6) ---

export interface ScheduleCategory {
  id: string;
  label: string;
  status: CategoryStatus;
  order: number;
  kata: boolean;
  progress: { played: number; total: number };
  nextMatches: { matchId: string; number: number; a: string; b: string }[];
}
export interface CategoryResultsData {
  records: (ResultRecord & { rev: string })[];
  ignored: ResultRecord[];
  progress: CategoryProgress;
  kataScores: KataScores;
  tieBreaks: { pools: Record<number, string[]>; kata: string[]; kataFinal: string[] };
  kataRevs: Record<string, { round1?: string; final?: string }>;
  tieBreakRevs: Record<string, string>;
}

// Révisions telles que l'écran les a lues (données en cache) : un autre poste qui a modifié entre-temps → 409.
// `undefined` (rien en cache) : pas de contrôle.
type QC = ReturnType<typeof useQueryClient>;
const categoryRevOf = (qc: QC, id: string, cid: string) => qc.getQueryData<Category[]>(['categories', id])?.find((c) => c.id === cid)?.rev;
const registrationRevOf = (qc: QC, id: string, rid: string) => qc.getQueryData<RegistrationRow[]>(['registrations', id])?.find((r) => r.id === rid)?.rev;
const resultsOf = (qc: QC, id: string, cid: string) => qc.getQueryData<CategoryResultsData>(['results', id, cid]);

/** Passage de la file d'une zone : un combat, ou un bloc de kata (`matchId` null). */
export interface QueueItem {
  number: number;
  categoryId: string;
  categoryLabel: string;
  matchId: string | null;
  a: string | null;
  b: string | null;
  katakas: number | null;
  kataPart: 'tour1' | 'finale' | null;
  noRest: boolean;
  /** Une saisie d'une zone autonome est à trancher dans cette catégorie. */
  held: boolean;
}
export interface ScheduleData {
  /** `waitingOtherZones` : combats de la zone qui attendent les résultats d'une autre zone. */
  zones: { zone: Zone; categories: ScheduleCategory[]; queue: QueueItem[]; waitingOtherZones: number }[];
  unassigned: ScheduleCategory[];
  impossible: PassagePlan['impossible'];
}

/** Jour J par zone ; avec une vague, la file de cette vague. */
export function useSchedule(id: string, waveId?: string | null, enabled = true) {
  return useQuery({
    queryKey: ['schedule', id, waveId ?? null],
    queryFn: () => api<ScheduleData>('GET', `/api/competitions/${id}/schedule${waveId ? `?vague=${encodeURIComponent(waveId)}` : ''}`),
    enabled,
  });
}

// --- Zones autonomes : journaux reçus et cartes « À trancher » (étape 21) ---

export interface JournalReport { received: number; applied: number; present: number; conflicts: number; waiting: number; alreadyReceived: number }
export interface ZoneCardData {
  id: string;
  zoneName: string;
  at: string;
  categoryId: string;
  categoryLabel: string;
  kind: 'result' | 'delete' | 'kata' | 'tie-break';
  target: string;
  zone: string;
  pc: string;
  status: 'conflict' | 'waiting';
  reason: string | null;
  canKeepZone: boolean;
}
export const useZoneCards = (id: string, enabled = true) =>
  useQuery({ queryKey: ['zone-cards', id], queryFn: () => api<ZoneCardData[]>('GET', `/api/competitions/${id}/zone-cards`), enabled });
/** Après une réception ou une décision : résultats, files et cartes relus. */
function useZoneMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries() });
}
export const useImportZoneJournal = (id: string) => useZoneMutation((journal: unknown) => api<JournalReport>('POST', `/api/competitions/${id}/zone-journal`, journal));
export const useDecideZoneCard = (id: string) => useZoneMutation((v: { entryId: string; keep: 'zone' | 'pc' }) => api<void>('POST', `/api/competitions/${id}/zone-cards/${v.entryId}`, { keep: v.keep }));

// --- Lancement des vagues (étape 13) ---

export type WaveState = 'preparation' | 'launched' | 'reopened' | 'finished';
export interface LaunchStatus {
  state: WaveState;
  blocking: string[];
  pending: { categoryId: string; label: string }[];
  zones: { zoneId: string; first: number | null; last: number | null }[];
}
export interface NumberChanges {
  changes: { categoryId: string; label: string; numbers: number[] }[];
  /** Ce qui empêche de numéroter (catégorie pas prête, sans zone possible). */
  blocking: string[];
}

/** État de lancement d'une vague (null : vague implicite) ; sous « categories » : rechargé avec elles. */
export function useLaunchStatus(id: string, waveId: string | null, restart = false, enabled = true) {
  return useQuery({
    queryKey: ['categories', id, 'launch', waveId, restart],
    queryFn: () => api<LaunchStatus>('GET', `/api/competitions/${id}/launch?vague=${encodeURIComponent(waveId ?? '')}${restart ? '&restart=1' : ''}`),
    enabled,
  });
}
function useLaunchAction<T, R = void>(id: string, method: 'POST', path: (arg: T) => string, body: (arg: T) => object | undefined, categoryOf?: (arg: T) => string) {
  const qc = useQueryClient();
  const invalidate = () => Promise.all(['categories', 'schedule', 'replacement'].map((k) => qc.invalidateQueries({ queryKey: [k, id] })));
  return useMutation({
    mutationFn: (arg: T) => api<R>(method, `/api/competitions/${id}${path(arg)}`, body(arg), { rev: categoryOf ? categoryRevOf(qc, id, categoryOf(arg)) : undefined }),
    onSuccess: invalidate,
    onError: invalidate,
  });
}
export const useLaunch = (id: string) => useLaunchAction<{ waveId: string | null; restart: boolean }>(id, 'POST', () => '/launch', (a) => a);
export const useReopen = (id: string) => useLaunchAction<{ waveId: string | null }>(id, 'POST', () => '/launch/reopen', (a) => a);
export type RenumberMode = 'append' | 'shuffle';
export interface MoveResult {
  changes: { categoryId: string; label: string; matchId: string | null; from: { zoneId: string; number: number } | null; to: { zoneId: string; number: number } }[];
  reprint: { categoryId: string; label: string }[];
}
export const useMoveCategory = (id: string) =>
  useLaunchAction<{ cid: string; zoneId: string; mode: RenumberMode }, MoveResult>(id, 'POST', (a) => `/categories/${a.cid}/move`, ({ zoneId, mode }) => ({ zoneId, mode }), (a) => a.cid);
/** Aperçu d'un déplacement ; `enabled` faux une fois le déplacement lancé (sinon l'aperçu rechargé dirait « déjà sur cette zone »). */
export function useMovePreview(id: string, cid: string, zoneId: string, mode: RenumberMode, enabled = true) {
  return useQuery({
    queryKey: ['categories', id, 'move', cid, zoneId, mode],
    queryFn: () => api<MoveResult>('POST', `/api/competitions/${id}/categories/${cid}/move/preview`, { zoneId, mode }),
    gcTime: 0,
    enabled,
  });
}
export const useNumberPending = (id: string) => useLaunchAction<{ waveId: string | null; categoryIds?: string[]; mode?: RenumberMode }, NumberChanges>(id, 'POST', () => '/launch/number', (a) => a);
export const useRegenerate = (id: string) => useLaunchAction<string, NumberChanges>(id, 'POST', (cid) => `/categories/${cid}/regenerate`, () => undefined, (cid) => cid);
export function useNumberPreview(id: string) {
  return useMutation({ mutationFn: (body: { waveId: string | null; mode?: RenumberMode }) => api<NumberChanges>('POST', `/api/competitions/${id}/launch/number/preview`, body) });
}

/** Zones et numéros de passage (clé sous « categories » : rechargés avec les catégories). */
export function usePassages(id: string) {
  return useQuery({ queryKey: ['categories', id, 'passages'], queryFn: () => api<PassagePlan>('GET', `/api/competitions/${id}/passages`) });
}

export function useWaves(id: string) {
  return useQuery({ queryKey: ['waves', id], queryFn: () => api<Wave[]>('GET', `/api/competitions/${id}/waves`) });
}

export function useSaveWaves(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { waves: WaveInput[]; knownIds: string[] }) => api<Wave[]>('PUT', `/api/competitions/${id}/waves`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['waves', id] });
      void qc.invalidateQueries({ queryKey: ['categories', id] });
      void qc.invalidateQueries({ queryKey: ['weigh-in', id] });
    },
  });
}

export function useZones(id: string, enabled = true) {
  return useQuery({ queryKey: ['zones', id], enabled: enabled && !!id, queryFn: () => api<Zone[]>('GET', `/api/competitions/${id}/zones`) });
}

export function useSaveZones(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { zones: ZoneInput[]; knownIds: string[] }) => api<Zone[]>('PUT', `/api/competitions/${id}/zones`, body),
    onSuccess: (saved) => {
      // Les zones enregistrées tout de suite dans le cache : le formulaire ne revient pas, le temps d'une relecture, à celles d'avant.
      qc.setQueryData(['zones', id], saved);
      void qc.invalidateQueries({ queryKey: ['zones', id] });
      void qc.invalidateQueries({ queryKey: ['schedule', id] });
      void qc.invalidateQueries({ queryKey: ['categories', id] });
    },
  });
}
export function useCategoryResults(id: string, cid: string | null) {
  return useQuery({
    queryKey: ['results', id, cid],
    queryFn: () => api<CategoryResultsData>('GET', `/api/competitions/${id}/categories/${cid}/results`),
    enabled: cid !== null,
  });
}
function useInvalidateResults(id: string) {
  const qc = useQueryClient();
  return () => Promise.all(['results', 'schedule', 'categories', 'podiums'].map((k) => qc.invalidateQueries({ queryKey: [k, id] })));
}
const resultRevOf = (qc: QC, id: string, cid: string, matchId: string) => {
  const data = resultsOf(qc, id, cid);
  return data ? (data.records.find((r) => r.matchId === matchId)?.rev ?? null) : undefined;
};
export function usePutResult(id: string) {
  const invalidate = useInvalidateResults(id);
  const qc = useQueryClient();
  return useMutation({
    // `rev` : celle du résultat à l'ouverture de la saisie (sinon celle en cache au moment d'enregistrer).
    mutationFn: ({ cid, matchId, rev, ...data }: { cid: string; matchId: string; winner: 'a' | 'b'; method: MatchMethod; score?: string | null; rev?: string | null }) =>
      api<{ affected: string[] }>('PUT', `/api/competitions/${id}/categories/${cid}/results/${matchId}`, data, { rev: rev !== undefined ? rev : resultRevOf(qc, id, cid, matchId) }),
    onSuccess: invalidate,
  });
}
export function useDeleteResult(id: string) {
  const invalidate = useInvalidateResults(id);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ cid, matchId, rev }: { cid: string; matchId: string; rev?: string | null }) =>
      api<void>('DELETE', `/api/competitions/${id}/categories/${cid}/results/${matchId}`, undefined, { rev: rev !== undefined ? rev : resultRevOf(qc, id, cid, matchId) }),
    onSuccess: invalidate,
  });
}
export function usePutKataNotes(id: string) {
  const invalidate = useInvalidateResults(id);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ cid, rid, round, notes }: { cid: string; rid: string; round: 'round1' | 'final'; notes: number[] }) => {
      const data = resultsOf(qc, id, cid);
      return api<void>('PUT', `/api/competitions/${id}/categories/${cid}/kata/${rid}/${round}`, { notes }, { rev: data ? (data.kataRevs[rid]?.[round] ?? null) : undefined });
    },
    onSuccess: invalidate,
  });
}
export function usePutTieBreak(id: string) {
  const invalidate = useInvalidateResults(id);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ cid, scope, order }: { cid: string; scope: string; order: string[] }) => {
      const data = resultsOf(qc, id, cid);
      return api<void>('PUT', `/api/competitions/${id}/categories/${cid}/tie-break`, { scope, order }, { rev: data ? (data.tieBreakRevs[scope] ?? null) : undefined });
    },
    onSuccess: invalidate,
  });
}
export function usePodiums(id: string) {
  return useQuery({
    queryKey: ['podiums', id],
    queryFn: () => api<{ categories: { id: string; label: string; podium: Podium; complete: boolean; status: 'not_started' | 'started' | 'finished' }[]; medals: MedalRow[] }>('GET', `/api/competitions/${id}/podiums`),
  });
}
export function useBackups(enabled = true) {
  return useQuery({ queryKey: ['backups'], enabled, queryFn: () => api<{ name: string; size: number; createdAt: string }[]>('GET', '/api/backups') });
}
export function useBackupNow() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api<{ file: string }>('POST', '/api/backups'), onSuccess: () => qc.invalidateQueries({ queryKey: ['backups'] }) });
}
export function useRestore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const res = await fetch('/api/restore', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: await file.arrayBuffer() });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new ApiError(res.status, data.error ?? `Erreur ${res.status}`);
      }
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}
export function useGridTemplates(enabled = true) {
  return useQuery({ queryKey: ['grid-templates'], enabled, queryFn: () => api<{ id: string; name: string; createdAt: string }[]>('GET', '/api/grid-templates') });
}
export function useSaveTemplate(id: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (name: string) => api<{ id: string }>('POST', `/api/competitions/${id}/grid/save-template`, { name }), onSuccess: () => qc.invalidateQueries({ queryKey: ['grid-templates'] }) });
}
export function useLoadTemplate(id: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (templateId: string) => api<void>('POST', `/api/competitions/${id}/grid/load-template`, { templateId }), onSuccess: () => qc.invalidateQueries({ queryKey: ['grid', id] }) });
}

// Annuaire des clubs (indépendant des compétitions).
export const useDirectory = () => useQuery({ queryKey: ['club-directory'], queryFn: () => api<DirectoryEntry[]>('GET', '/api/club-directory') });

function useDirectoryMutation<V>(fn: (v: V) => Promise<DirectoryEntry>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['club-directory'] }) });
}
export const useCreateDirectoryEntry = () => useDirectoryMutation((input: DirectoryInput) => api<DirectoryEntry>('POST', '/api/club-directory', input));
export const useUpdateDirectoryEntry = () =>
  useDirectoryMutation(({ id, ...patch }: Partial<DirectoryInput> & { id: string; archived?: boolean; googleContactId?: null }) => api<DirectoryEntry>('PATCH', `/api/club-directory/${id}`, patch));
export const useMergeDirectoryEntries = () =>
  useDirectoryMutation((ids: { keepId: string; mergeId: string }) => api<DirectoryEntry>('POST', '/api/club-directory/merge', ids));

const GOOGLE_CONTACTS_KEY = 'google-contacts';
/**
 * Aperçu de la synchronisation avec Google Contacts. `label` : undefined = le dernier libellé choisi, null = tous les contacts.
 * Google est relu à chaque ouverture de la page et à chaque changement de libellé (même déjà vu : le serveur retient le libellé
 * choisi). Jamais relu tout seul (retour sur l'onglet, réseau revenu) : les choix en cours à l'écran seraient perdus.
 */
export const useGoogleContactsPreview = (label: string | null | undefined) =>
  useQuery({
    queryKey: [GOOGLE_CONTACTS_KEY, label === undefined ? 'enregistré' : label],
    queryFn: () => api<GoogleContactsView>('POST', '/api/club-directory/google/preview', label === undefined ? {} : { label }),
    placeholderData: keepPreviousData,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
export function useApplyGoogleContacts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SyncApply) => api<{ updated: number; linked: number; created: number }>('POST', '/api/club-directory/google/apply', input),
    onSuccess: () => Promise.all([['club-directory'], [GOOGLE_CONTACTS_KEY]].map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
}

// Inscriptions en ligne : liens personnels des clubs, ouverture et gel.
export interface ClubInvitationRow {
  clubId: string;
  clubName: string;
  directoryClubId: string | null;
  coachEmail: string | null;
  invited: boolean;
  invitedAt: string | null;
  lastUsedAt: string | null;
  fighters: number;
  lastMail: { sentAt: string; status: 'sent' | 'error'; error: string | null } | null;
}
export interface InvitationLink { clubId: string; clubName: string; token: string }
export interface ClubEntrySettings { status: 'closed' | 'open' | 'frozen'; deadline: string | null; managedHere: boolean }

export const useInvitations = (id: string) =>
  useQuery({ queryKey: ['invitations', id], queryFn: () => api<ClubInvitationRow[]>('GET', `/api/competitions/${id}/invitations`) });
export const useClubEntrySettings = (id: string) =>
  useQuery({ queryKey: ['club-entry', id], queryFn: () => api<ClubEntrySettings>('GET', `/api/competitions/${id}/club-entry`) });

function useOnlineEntryMutation<V, R>(id: string, fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all([['invitations', id], ['club-entry', id], ['clubs', id], ['club-directory']].map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
}
export const useInviteClubs = (id: string) =>
  useOnlineEntryMutation(id, (directoryIds: string[]) => api<InvitationLink[]>('POST', `/api/competitions/${id}/invitations`, { directoryIds }));
export const useRegenerateInvitation = (id: string) =>
  useOnlineEntryMutation(id, (clubId: string) => api<InvitationLink>('POST', `/api/competitions/${id}/invitations/${clubId}/regenerate`));
export const useRevokeInvitation = (id: string) =>
  useOnlineEntryMutation(id, (clubId: string) => api<void>('DELETE', `/api/competitions/${id}/invitations/${clubId}`));
export const useUpdateClubEntrySettings = (id: string) =>
  useOnlineEntryMutation(id, (patch: { status?: 'open' | 'frozen'; deadline?: string | null }) => api<ClubEntrySettings>('PATCH', `/api/competitions/${id}/club-entry`, patch));

// Page d'inscription d'un club (lien personnel, sans compte).
/** Refus après lesquels la page du club est rechargée et le formulaire fermé. */
export const RELOAD_STATUSES = new Set([403, 404, 409]);
export interface ClubLine { fighterId: string; version: string; line: ClubFormLine; editable: boolean; reason: string | null; notices: string[] }
export interface ClubEntryHeader { coachName: string | null; coachPhone: string | null; coachEmail: string | null; preApproval: boolean; affiliationNumber: string | null }
export interface ClubEntryView {
  competition: { name: string; date: string; location: string | null; deadline: string | null; status: 'closed' | 'open' | 'frozen' };
  editable: boolean;
  club: ClubEntryHeader & { name: string };
  ageBands: { code: string; label: string; isMinor: boolean }[];
  /** Cases fermées (`entryKey`). */
  closed: string[];
  closedSummary: string[];
  lines: ClubLine[];
  privacyNotice: string;
}

export const useClubEntry = (token: string) =>
  useQuery({ queryKey: ['inscription', token], queryFn: () => api<ClubEntryView>('GET', `/api/inscription/${token}`) });

/** Après une écriture (réussie, ou refusée : périmée, close, combattant ou lien disparus) : la page du club est rechargée. */
function useClubEntryMutation<V, R>(token: string, fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  const reload = () => qc.invalidateQueries({ queryKey: ['inscription', token] });
  return useMutation({
    mutationFn: fn,
    onSuccess: reload,
    onError: (e) => (e instanceof ApiError && RELOAD_STATUSES.has(e.status) ? reload() : undefined),
  });
}
export const useSaveClubHeader = (token: string) =>
  useClubEntryMutation(token, (header: ClubEntryHeader) => api<ClubEntryView['club']>('PATCH', `/api/inscription/${token}/club`, header));
export const useSaveClubLine = (token: string) =>
  useClubEntryMutation(token, ({ fighterId, line, version }: { fighterId: string | null; line: ClubFormLine; version: string | null }) =>
    fighterId
      ? api<ClubLine>('PUT', `/api/inscription/${token}/lines/${fighterId}`, { line, version })
      : api<ClubLine>('POST', `/api/inscription/${token}/lines`, { line }));
export const useDeleteClubLine = (token: string) =>
  useClubEntryMutation(token, ({ fighterId, version }: { fighterId: string; version: string }) =>
    api<void>('DELETE', `/api/inscription/${token}/lines/${fighterId}?version=${encodeURIComponent(version)}`));

// Connexion des organisateurs (rôle serveur) et comptes.
export type UserRole = 'organisateur' | 'table' | 'zone';
/** Rôle d'un compte ; un compte Zone est attaché à une zone d'une compétition. */
export interface AccountRole { role: UserRole; competitionId: string | null; zoneId: string | null }
export interface AuthMe { role: 'serveur' | 'local'; user: ({ email: string } & AccountRole) | null }
export interface UserRow extends AccountRole { id: string; email: string; createdAt: string; competitionName: string | null; zoneName: string | null }

export const useAuthMe = () => useQuery({ queryKey: ['auth'], queryFn: () => api<AuthMe>('GET', '/api/auth/me'), staleTime: 60_000 });
/** Tout est permis : rôle local (pas de comptes), ou compte Organisateur. */
export const isOrganiser = (me: AuthMe | undefined) => !me?.user || me.user.role === 'organisateur';
export const useIsOrganiser = () => isOrganiser(useAuthMe().data);
/** Vrai quand la session a été perdue en cours de route (la fenêtre de reconnexion s'affiche par-dessus l'écran). */
export const useAuthExpired = () =>
  useQuery({ queryKey: ['auth-expired'], queryFn: async () => false, initialData: false, staleTime: Infinity }).data;
export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { email: string; password: string }) => api<void>('POST', '/api/auth/login', v),
    // Les écrans ouverts gardent leur état : seules les données sont relues.
    onSuccess: () => {
      qc.setQueryData(['auth-expired'], false);
      return qc.invalidateQueries();
    },
  });
}
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api<void>('POST', '/api/auth/logout'), onSuccess: () => qc.resetQueries() });
}
export const useUsers = (enabled = true) => useQuery({ queryKey: ['users'], enabled, queryFn: () => api<UserRow[]>('GET', '/api/users') });
function useUsersMutation<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }) });
}
export const useCreateUser = () => useUsersMutation((v: { email: string; password: string } & AccountRole) => api('POST', '/api/users', v));
export const useUpdateUserRole = () => useUsersMutation(({ id, ...v }: { id: string } & AccountRole) => api('PATCH', `/api/users/${id}`, v));
export const useDeleteUser = () => useUsersMutation((id: string) => api('DELETE', `/api/users/${id}`));
export const useChangePassword = () => useMutation({ mutationFn: (v: { current: string; next: string }) => api<void>('PUT', '/api/users/me/password', v) });

// Réglages de l'application (envoi des mails, mention, conservation, message aux clubs).
export const useAppSettings = () => useQuery({ queryKey: ['app-settings'], queryFn: () => api<PublicAppSettings>('GET', '/api/app-settings') });
export function useUpdateAppSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: AppSettingsPatch) => api<PublicAppSettings>('PATCH', '/api/app-settings', patch),
    onSuccess: (s) => qc.setQueryData(['app-settings'], s),
  });
}
export const useSendTestMail = () => useMutation({ mutationFn: (to: string) => api<void>('POST', '/api/app-settings/test-mail', { to }) });
/** « Se connecter avec Google » : le serveur donne l'adresse de Google, le navigateur y va (retour sur /parametres?google=…). */
export const useGoogleStart = () =>
  useMutation({ mutationFn: () => api<{ url: string }>('POST', '/api/app-settings/google/start'), onSuccess: ({ url }) => window.location.assign(url) });
export function useGoogleDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ revoked: boolean }>('POST', '/api/app-settings/google/disconnect'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['app-settings'] }),
  });
}

// Envoi des liens par mail (un nouveau lien à chaque envoi).
export interface SendResult { clubId: string; clubName: string; email: string | null; status: 'sent' | 'error'; error: string | null }
export const useSendInvitations = (id: string) =>
  useOnlineEntryMutation(id, (clubIds: string[]) => api<SendResult[]>('POST', `/api/competitions/${id}/invitations/send`, { clubIds }));
export const useMailtoInvitation = (id: string) =>
  useOnlineEntryMutation(id, (clubId: string) => api<{ to: string | null; subject: string; body: string }>('POST', `/api/competitions/${id}/invitations/${clubId}/mailto`));
export const useInvitationPreview = (id: string, clubId: string | null, version: string) =>
  useQuery({
    queryKey: ['invitation-preview', id, clubId, version],
    queryFn: () => api<{ subject: string; body: string }>('GET', `/api/competitions/${id}/invitations/preview?clubId=${clubId}`),
    enabled: !!clubId,
  });

// Passage de main entre le serveur et le PC.
export interface Management { managedHere: boolean; ownerName: string | null; ownerSince: string | null; lastSyncAt: string | null; copyOfServer: boolean; rescueSince: string | null; copyOfMain: boolean }
export interface ServerCompetition { id: string; name: string; date: string; managedHere: boolean; ownerName: string | null; clubEntryStatus: 'closed' | 'open' | 'frozen' }
export const useManagement = (id: string) =>
  useQuery({ queryKey: ['management', id], queryFn: () => api<Management>('GET', `/api/competitions/${id}/management`) });
/** Liaison du PC au serveur (rôle local seulement : la route n'existe pas en ligne). */
export const useSyncSettings = (enabled = true) => useQuery({ queryKey: ['sync-settings'], enabled, queryFn: () => api<{ url: string | null; hasToken: boolean }>('GET', '/api/sync/settings') });
export function useUpdateSyncSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { url: string; token: string | null }) => api<{ url: string | null; hasToken: boolean }>('PATCH', '/api/sync/settings', v),
    onSuccess: (s) => qc.setQueryData(['sync-settings'], s),
  });
}
export const useServerCompetitions = (enabled: boolean) =>
  useQuery({ queryKey: ['server-competitions'], queryFn: () => api<ServerCompetition[]>('GET', '/api/sync/server-competitions'), enabled });
/** Après un échange : toutes les données sont relues (la compétition a pu changer entièrement). */
function useSyncMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries() });
}
export const usePull = () => useSyncMutation((v: { competitionId: string; take: boolean }) => api<{ competitionId: string; created: boolean }>('POST', '/api/sync/pull', v));
/** Copie tenue à jour (PC relié) : réglage et dernier état. */
export interface SyncFollowView { competitionId: string | null; intervalMin: number; lastSuccessAt: string | null; lastError: string | null }
export const useSyncFollow = (enabled: boolean) =>
  useQuery({ queryKey: ['sync-follow'], queryFn: () => api<SyncFollowView>('GET', '/api/sync/follow'), enabled, refetchInterval: 30_000 });
export function useSetSyncFollow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { competitionId: string; intervalMin: number } | null) => api<SyncFollowView>('PUT', '/api/sync/follow', v),
    onSuccess: (f) => qc.setQueryData(['sync-follow'], f),
  });
}
export const useRescue = (id: string) => useSyncMutation(() => api<void>('POST', `/api/competitions/${id}/sync/rescue`));
export const useRescueNotify = (id: string) => useSyncMutation((replace: boolean) => api<void>('POST', `/api/competitions/${id}/sync/rescue/notify`, { replace }));
export const useSyncCopy = (id: string) => useSyncMutation(() => api<{ sentAt: string }>('POST', `/api/competitions/${id}/sync/copy`));
export const useSyncReturn = (id: string) => useSyncMutation(() => api<void>('POST', `/api/competitions/${id}/sync/return`));
export const useTakeBack = (id: string) => useSyncMutation((source: 'server' | 'lastCopy') => api<void>('POST', `/api/competitions/${id}/take-back`, { source }));
export const useReceivedCopies = (id: string, enabled: boolean) =>
  useQuery({ queryKey: ['received-copies', id], queryFn: () => api<{ id: string; fromName: string; receivedAt: string }[]>('GET', `/api/competitions/${id}/received-copies`), enabled });
export const useImportCompetition = () =>
  useSyncMutation(({ pkg, confirm }: { pkg: unknown; confirm?: 'replace' | 'takeOver' }) =>
    api<{ competitionId: string; created: boolean }>('POST', `/api/competitions/import${confirm ? `?${confirm}=1` : ''}`, pkg));
export interface SyncTokenRow { id: string; name: string; createdAt: string; lastUsedAt: string | null; revoked: boolean }
export const useSyncTokens = (enabled: boolean) => useQuery({ queryKey: ['sync-tokens'], queryFn: () => api<SyncTokenRow[]>('GET', '/api/sync/tokens'), enabled });
function useTokenMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['sync-tokens'] }) });
}
export const useCreateSyncToken = () => useTokenMutation((name: string) => api<{ id: string; name: string; token: string }>('POST', '/api/sync/tokens', { name }));
export const useRevokeSyncToken = () => useTokenMutation((id: string) => api<void>('DELETE', `/api/sync/tokens/${id}`));
export const useExportHandOver = (id: string) => useSyncMutation(() => api<unknown>('POST', `/api/competitions/${id}/export-handover`));
export function useUnlinkSync() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api<void>('DELETE', '/api/sync/settings'), onSuccess: () => qc.invalidateQueries({ queryKey: ['sync-settings'] }) });
}

// Copie de secours d'un autre PC (rôle local).
export interface MirrorView { url: string | null; intervalMin: number; lastSuccessAt: string | null; lastError: string | null }
export const useMirror = (enabled: boolean) => useQuery({ queryKey: ['mirror'], queryFn: () => api<MirrorView>('GET', '/api/mirror'), enabled, refetchInterval: 60_000 });
export function useSetMirror() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { url: string | null; intervalMin: number }) => api<MirrorView>('PUT', '/api/mirror', v), onSuccess: (m) => qc.setQueryData(['mirror'], m) });
}
export const useMirrorCopies = (enabled: boolean) =>
  useQuery({ queryKey: ['mirror-copies'], queryFn: () => api<{ name: string; size: number; createdAt: string }[]>('GET', '/api/mirror/copies'), enabled, refetchInterval: 60_000 });
// Portable de zone : relié au PC principal, il en garde une copie à jour.
export interface ZoneLinkView {
  link: { mainUrl: string; competitionId: string; zoneId: string; autonomous: { since: string; finals: boolean } | null } | null;
  zoneName: string | null;
  status: { lastCopyAt: string | null; lastError: string | null };
  pending: number;
}
export const useZoneLink = (enabled: boolean) => useQuery({ queryKey: ['zone-link'], queryFn: () => api<ZoneLinkView>('GET', '/api/zone-link'), enabled, refetchInterval: 5_000 });
export function useSetZoneLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { mainUrl: string; competitionId: string; zoneId: string } | null) => api<ZoneLinkView>('PUT', '/api/zone-link', v),
    onSuccess: (l) => qc.setQueryData(['zone-link'], l),
  });
}
/** Gestes de la zone autonome : toutes les données sont relues ensuite (lecture seule levée ou remise, copie reprise). */
function useZoneLinkMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries() });
}
export const useStartAutonomy = () => useZoneLinkMutation(() => api<void>('POST', '/api/zone-link/autonomous'));
export const useGoOnline = () =>
  useZoneLinkMutation(() => api<{ report: JournalReport; zoneName: string; mainUrl: string }>('POST', '/api/zone-link/online'));
/** Copie plus récente pendant la coupure : par le réseau (sans `pkg`) ou un fichier de compétition. */
export const useRefreshZoneCopy = () =>
  useZoneLinkMutation((pkg: unknown) => api<{ reapplied: number; present: number; conflicts: number }>('POST', '/api/zone-link/refresh', pkg ?? undefined));
export const usePlayFinalsHere = () => useZoneLinkMutation(() => api<void>('POST', '/api/zone-link/finals'));
export const useStopAutonomy = () => useZoneLinkMutation((exportedUpToSeq: number) => api<void>('POST', '/api/zone-link/stop', { exportedUpToSeq }));
/** Le journal en fichier (clé USB) : téléchargé tel que le serveur le nomme ; renvoie la dernière saisie qu'il contient (0 : aucune). */
export async function downloadZoneJournal(): Promise<number> {
  const res = await fetch('/api/zone-link/journal.json');
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, data.error ?? `Erreur ${res.status}`);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'journal-zone.json';
  const text = await res.text();
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return Math.max(0, ...(JSON.parse(text) as { entries: { seq: number }[] }).entries.map((e) => e.seq));
}
export const useProbeMain = () =>
  useMutation({ mutationFn: (mainUrl: string) => api<{ competitions: { id: string; name: string; zones: { id: string; name: string }[] }[] }>('POST', '/api/zone-link/probe', { mainUrl }) });
export function useRestoreMirrorCopy() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (name: string) => api<void>('POST', `/api/mirror/copies/${encodeURIComponent(name)}/restore`), onSuccess: () => qc.invalidateQueries() });
}
