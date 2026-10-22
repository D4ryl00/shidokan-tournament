import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Competition, CompetitionInput } from '../domain/competition.js';
import type { BracketFormat, KataScores, MatchMethod, Podium } from '../domain/brackets/index.js';
import type { CategoryProgress, MedalRow, ResultRecord } from '../domain/results.js';
import type { Category, CategoryStatus } from '../domain/categories.js';
import type { ClubFormHeader, ClubFormLine, ClubFormParse } from '../domain/club-form.js';
import type { ColumnMapping, FfkChoices, FfkImportPlan } from '../domain/ffk-import.js';
import type { Club, RegistrationInput, RegistrationRow } from '../domain/registration.js';
import type { Case, Presence, Proposal, ProposalType } from '../domain/replacement/index.js';
import type { CategoryGrid, DisciplineId } from '../domain/types.js';
import type { Wave, WaveInput } from '../domain/waves.js';
import type { Zone, ZoneInput } from '../domain/zones.js';
import type { PassagePlan } from '../domain/passages/index.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
  }
}

export async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; issues?: string[] };
    throw new ApiError(res.status, data.error ?? `Erreur ${res.status}`, data.issues ?? []);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const useCompetitions = () =>
  useQuery({ queryKey: ['competitions'], queryFn: () => api<Competition[]>('GET', '/api/competitions') });

export const useCompetition = (id: string) =>
  useQuery({ queryKey: ['competitions', id], queryFn: () => api<Competition>('GET', `/api/competitions/${id}`) });

export function useCreateCompetition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CompetitionInput & { templateId?: string }) => api<Competition>('POST', '/api/competitions', input),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['grid', id] }),
  });
}

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
  return useMutation({
    mutationFn: ({ rid, input }: { rid: string; input: RegistrationInput }) =>
      api<RegistrationRow>('PUT', `/api/competitions/${id}/registrations/${rid}`, input),
    onSuccess: invalidate,
  });
}

export function useDeleteRegistration(id: string) {
  const invalidate = useInvalidateRegistrations(id);
  return useMutation({
    mutationFn: (rid: string) => api<void>('DELETE', `/api/competitions/${id}/registrations/${rid}`),
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

function useCategoryMutation<T>(id: string, fn: (arg: T) => Promise<Category>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all(['categories', 'schedule'].map((k) => qc.invalidateQueries({ queryKey: [k, id] }))) });
}

export const useUpdateCategory = (id: string) =>
  useCategoryMutation(id, ({ cid, ...patch }: { cid: string; format?: BracketFormat | null; repechage?: boolean | null; thirdPlace?: boolean | null; status?: CategoryStatus; unlock?: boolean; zoneId?: string | null; waveOverride?: string | null; order?: number }) =>
    api<Category>('PATCH', `/api/competitions/${id}/categories/${cid}`, patch),
  );
export const useRedraw = (id: string) => useCategoryMutation(id, (cid: string) => api<Category>('POST', `/api/competitions/${id}/categories/${cid}/redraw`));
export const useSwap = (id: string) =>
  useCategoryMutation(id, ({ cid, a, b }: { cid: string; a: string; b: string }) => api<Category>('POST', `/api/competitions/${id}/categories/${cid}/swap`, { a, b }));

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

function useInvalidateDay(id: string) {
  const qc = useQueryClient();
  return () => Promise.all(['weigh-in', 'replacement', 'categories', 'registrations'].map((k) => qc.invalidateQueries({ queryKey: [k, id] })));
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
export interface ReplacementData {
  cases: Case[];
  /** Les propositions refusées suivent les autres, marquées `refused`. */
  proposals: Record<string, (Proposal & { refused?: true })[]>;
  summary: { present: number; absent: number; unknown: number; cases: number; alone: number; withoutProposal: number; readyCategories: number; startedCategories: number };
  fingerprint: string;
  recasements: RecasementEntry[];
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
    mutationFn: (body: { proposalId: string } | { bulk: 'simple' | 'all'; waveId?: string } | { move: { registrationId: string; categoryId: string } }) =>
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
export const useBulkReplacement = (id: string) => useReplacementAction<{ mode: 'simple' | 'all'; fingerprint: string; waveId?: string }>(id, 'bulk');
export const useUndoRecasement = (id: string) => useReplacementAction<{ recasementId: string }>(id, 'undo');
export const useManualMove = (id: string) => useReplacementAction<{ registrationId: string; categoryId: string }>(id, 'move');

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
  records: ResultRecord[];
  ignored: ResultRecord[];
  progress: CategoryProgress;
  kataScores: KataScores;
  tieBreaks: { pools: Record<number, string[]>; kata: string[]; kataFinal: string[] };
}

/** Passage de la file d'une zone : un combat, ou un bloc de kata (`matchId` null). */
export interface QueueItem {
  number: number;
  categoryId: string;
  categoryLabel: string;
  matchId: string | null;
  a: string | null;
  b: string | null;
  katakas: number | null;
  noRest: boolean;
}
export interface ScheduleData {
  zones: { zone: Zone; categories: ScheduleCategory[]; queue: QueueItem[] }[];
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

export function useZones(id: string) {
  return useQuery({ queryKey: ['zones', id], queryFn: () => api<Zone[]>('GET', `/api/competitions/${id}/zones`) });
}

export function useSaveZones(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { zones: ZoneInput[]; knownIds: string[] }) => api<Zone[]>('PUT', `/api/competitions/${id}/zones`, body),
    onSuccess: () => {
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
export function usePutResult(id: string) {
  const invalidate = useInvalidateResults(id);
  return useMutation({
    mutationFn: ({ cid, matchId, ...data }: { cid: string; matchId: string; winner: 'a' | 'b'; method: MatchMethod; score?: string | null }) =>
      api<{ affected: string[] }>('PUT', `/api/competitions/${id}/categories/${cid}/results/${matchId}`, data),
    onSuccess: invalidate,
  });
}
export function useDeleteResult(id: string) {
  const invalidate = useInvalidateResults(id);
  return useMutation({ mutationFn: ({ cid, matchId }: { cid: string; matchId: string }) => api<void>('DELETE', `/api/competitions/${id}/categories/${cid}/results/${matchId}`), onSuccess: invalidate });
}
export function usePutKataNotes(id: string) {
  const invalidate = useInvalidateResults(id);
  return useMutation({
    mutationFn: ({ cid, rid, round, notes }: { cid: string; rid: string; round: 'round1' | 'final'; notes: number[] }) =>
      api<void>('PUT', `/api/competitions/${id}/categories/${cid}/kata/${rid}/${round}`, { notes }),
    onSuccess: invalidate,
  });
}
export function usePutTieBreak(id: string) {
  const invalidate = useInvalidateResults(id);
  return useMutation({
    mutationFn: ({ cid, scope, order }: { cid: string; scope: string; order: string[] }) => api<void>('PUT', `/api/competitions/${id}/categories/${cid}/tie-break`, { scope, order }),
    onSuccess: invalidate,
  });
}
export function usePodiums(id: string) {
  return useQuery({
    queryKey: ['podiums', id],
    queryFn: () => api<{ categories: { id: string; label: string; podium: Podium; complete: boolean; status: string }[]; medals: MedalRow[] }>('GET', `/api/competitions/${id}/podiums`),
  });
}
export function useBackups() {
  return useQuery({ queryKey: ['backups'], queryFn: () => api<{ name: string; size: number; createdAt: string }[]>('GET', '/api/backups') });
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
export function useGridTemplates() {
  return useQuery({ queryKey: ['grid-templates'], queryFn: () => api<{ id: string; name: string; createdAt: string }[]>('GET', '/api/grid-templates') });
}
export function useSaveTemplate(id: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (name: string) => api<{ id: string }>('POST', `/api/competitions/${id}/grid/save-template`, { name }), onSuccess: () => qc.invalidateQueries({ queryKey: ['grid-templates'] }) });
}
export function useLoadTemplate(id: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (templateId: string) => api<void>('POST', `/api/competitions/${id}/grid/load-template`, { templateId }), onSuccess: () => qc.invalidateQueries({ queryKey: ['grid', id] }) });
}
