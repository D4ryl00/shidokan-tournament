import {
  ActionIcon, Alert, Button, Checkbox, List, Modal, Group, MultiSelect, NumberInput, Select, SimpleGrid, Stack, Switch, Text, TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { useParams } from 'react-router';
import type { CombatFormat, CompetitionSettings, PassageOrderMode } from '../../domain/settings.js';
import { DISCIPLINES } from '../../domain/disciplines.js';
import type { DisciplineId } from '../../domain/types.js';
import { useCategories, useCompetition, useGrid, usePassages, useSaveZones, useUpdateCompetition, useZones } from '../api.js';
import { ZonesImpossibleAlert } from '../components/ZonesImpossibleAlert.js';
import { nextZoneName, validateZones, ZONE_MAX } from '../../domain/zones.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { DateField } from '../components/ui/DateField.js';
import { IconArrowDown, IconArrowUp, IconTrash } from '../components/ui/icons.js';
import { SectionCard } from '../components/ui/SectionCard.js';
import { StatusBadge } from '../components/ui/StatusBadge.js';
import { useUnsaved } from '../unsaved.js';
import { settingsPatch } from '../settingsPatch.js';
import { SyncPanel } from '../components/SyncPanel.js';
import { HELP } from '../help.js';

export const FORMAT_LABELS: Record<CombatFormat, string> = {
  single_match: 'Un seul combat',
  best_of_three: 'Au meilleur des trois',
  round_robin: 'Poule (tous contre tous)',
  three_with_repechage: '3 combattants avec repêchage',
  single_elimination: 'Élimination directe',
  double_elimination: 'Double élimination',
  pools_then_bracket: 'Poules puis tableau final',
};
const FORMAT_OPTIONS = Object.entries(FORMAT_LABELS).map(([value, label]) => ({ value, label }));
const ALL_DISCIPLINES = Object.keys(DISCIPLINES) as DisciplineId[];
const PASSAGE_ORDER_OPTIONS: { value: PassageOrderMode; label: string }[] = [
  { value: 'rounds', label: 'Tour par tour' },
  { value: 'categories', label: 'Catégorie par catégorie' },
];

/** NumberInput sans bornage côté client : le serveur valide et explique. */
/** Sommaire : section → ancre. */
const SECTIONS = {
  'reglages.competition': 'competition', 'reglages.zones': 'zones', 'reglages.ordre': 'ordre', 'reglages.recasement': 'reaffectation',
  'reglages.pesee': 'pesee', 'reglages.tableaux': 'tableaux', 'reglages.kata': 'kata', 'reglages.echanges': 'echanges',
} as const;

function Kg(props: { label: string; value: number; onChange: (v: number) => void; testId?: string }) {
  return (
    <NumberInput data-testid={props.testId} label={props.label} suffix=" kg" decimalScale={2} clampBehavior="none"
      value={props.value} onChange={(v) => props.onChange(typeof v === 'number' ? v : Number(v))} />
  );
}

export function CompetitionSettingsPage() {
  const { id = '' } = useParams();
  const { data: competition } = useCompetition(id);
  const { data: grid } = useGrid(id);
  const update = useUpdateCompetition(id);
  const [info, setInfo] = useState({ name: '', date: '', location: '' });
  const [s, setS] = useState<CompetitionSettings | null>(null);
  const { data: savedZones } = useZones(id);
  const saveZones = useSaveZones(id);
  const { data: categories = [] } = useCategories(id);
  // `key` : identifiant d'affichage stable, y compris pour une zone pas encore enregistrée.
  // Disciplines accueillies : null = toutes.
  const [zones, setZones] = useState<{ key: string; id?: string; name: string; disciplines: DisciplineId[] | null }[]>([]);
  const { data: passages } = usePassages(id);
  const [zoneErrors, setZoneErrors] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  // Catégories de la zone, épinglées ou réparties automatiquement.
  const zoneCategories = (zid?: string) => (zid ? categories.filter((c) => (passages?.categories[c.id]?.zoneId ?? c.zoneId) === zid) : []);
  const zoneLocked = (zid?: string) => zoneCategories(zid).some((c) => c.status === 'started' || c.status === 'finished');
  const removeZone = (key: string) => {
    setZones((zs) => zs.filter((z) => z.key !== key));
    setDeleting(null);
  };
  const deletingZone = zones.find((z) => z.key === deleting);
  const deletingCount = zoneCategories(deletingZone?.id).length;
  const toggleDiscipline = (key: string, d: DisciplineId) =>
    setZones((zs) =>
      zs.map((z) => {
        if (z.key !== key) return z;
        const current = z.disciplines ?? ALL_DISCIPLINES;
        const next = current.includes(d) ? current.filter((x) => x !== d) : ALL_DISCIPLINES.filter((x) => x === d || current.includes(x));
        return { ...z, disciplines: next.length === ALL_DISCIPLINES.length ? null : next };
      }),
    );
  const moveZone = (i: number, d: -1 | 1) =>
    setZones((zs) => {
      const next = [...zs];
      [next[i], next[i + d]] = [next[i + d]!, next[i]!];
      return next;
    });

  // Le formulaire part de `base` (réglages et zones tels que chargés). Rechargés (autre poste, retour sur l'onglet…) pendant une
  // saisie, ils ne l'écrasent pas : l'enregistrement n'envoie que ce qui a changé depuis `base`, feuille par feuille.
  // `from` : la donnée chargée ; une plus récente est reprise dès que le formulaire n'a plus de modification (même défaite à la main).
  const [base, setBase] = useState<{ info: typeof info; settings: CompetitionSettings; from: unknown } | null>(null);
  const [zonesBase, setZonesBase] = useState<{ view: string; ids: string[]; from: unknown } | null>(null);
  const formDirty = !!base && !!s && (JSON.stringify(s) !== JSON.stringify(base.settings) || JSON.stringify(info) !== JSON.stringify(base.info));
  const zonesDirty = zonesBase !== null && JSON.stringify(zones) !== zonesBase.view;
  const loadCompetition = (c: NonNullable<typeof competition>) => {
    const next = { info: { name: c.name, date: c.date, location: c.location ?? '' }, settings: c.settings, from: c };
    setBase(next);
    setInfo(next.info);
    setS(next.settings);
  };
  const loadZones = (zs: NonNullable<typeof savedZones>) => {
    const view = zs.map(({ id: zid, name, disciplines }) => ({ key: zid, id: zid, name, disciplines }));
    setZonesBase({ view: JSON.stringify(view), ids: zs.map((z) => z.id), from: zs });
    setZones(view);
  };
  if (competition && competition !== base?.from && !formDirty) loadCompetition(competition);
  if (savedZones && savedZones !== zonesBase?.from && !zonesDirty) loadZones(savedZones);
  // Saisie en cours : la mise à jour automatique (autre poste) attend, et quitter l'onglet demande confirmation.
  const dirty = formDirty || zonesDirty;
  useUnsaved('reglages', dirty);

  if (!s) return null;
  const set = (patch: Partial<CompetitionSettings>) => setS({ ...s, ...patch });
  const bandOptions = (grid?.ageBands ?? []).map((b) => ({ value: b.code, label: b.label }));

  // Zones vérifiées avant tout envoi, puis enregistrées en premier : une erreur n'enregistre rien d'autre.
  const save = () => {
    const input = zones.map(({ id: zid, name, disciplines }) => (zid ? { id: zid, name, disciplines } : { name, disciplines }));
    const errors = validateZones(input);
    setZoneErrors(errors);
    if (errors.length) return;
    const from = base!;
    // Les zones que le formulaire a vues : une zone ajoutée ailleurs entre-temps fait refuser l'envoi (jamais supprimée sans être vue).
    saveZones.mutate({ zones: input, knownIds: zonesBase?.ids ?? [] }, {
      onSuccess: (saved) => {
        loadZones(saved);
        update.mutate(
          // Seuls les champs et réglages changés ici : ce qu'un autre poste a changé entre-temps (dont la liste des règles et ses
          // interrupteurs, réglés dans Réaffectation) reste tel quel.
          {
            ...(info.name !== from.info.name ? { name: info.name } : {}),
            ...(info.date !== from.info.date ? { date: info.date } : {}),
            ...(info.location !== from.info.location ? { location: info.location || null } : {}),
            settings: settingsPatch(from.settings, s),
          },
          {
            onSuccess: (c) => {
              loadCompetition(c);
              notifications.show({ color: 'green', message: 'Réglages enregistrés' });
            },
          },
        );
      },
    });
  };

  return (
    <Stack data-testid="settings-form" gap="lg">
      <Group gap="xs" data-testid="settings-summary">
        {Object.entries(SECTIONS).map(([topic, aid]) => (
          <Button key={aid} component="a" href={`#${aid}`} size="compact-sm" variant="subtle">{HELP[topic as keyof typeof SECTIONS].title}</Button>
        ))}
      </Group>
      <SectionCard id="competition" title={HELP['reglages.competition'].title} help="reglages.competition">
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Nom" style={{ gridColumn: '1 / -1' }} value={info.name} onChange={(e) => setInfo({ ...info, name: e.currentTarget.value })} />
          <DateField label="Date" value={info.date} onChange={(v) => v && setInfo({ ...info, date: v })} />
          <TextInput label="Lieu" value={info.location} onChange={(e) => setInfo({ ...info, location: e.currentTarget.value })} />
        </SimpleGrid>
      </SectionCard>

      <SectionCard id="zones" title={HELP['reglages.zones'].title} help="reglages.zones">
        <Stack gap="xs">
          {zones.map((z, i) => (
            <Stack key={z.key} gap={6} data-testid="zone-row" p="sm" style={{ border: '1px solid var(--sk-line)', borderRadius: 'var(--mantine-radius-md)' }}>
            <Group gap="xs" wrap="nowrap">
              <TextInput data-testid="zone-name" aria-label={`Nom de la zone ${i + 1}`} w={260} maxLength={40} value={z.name}
                onChange={(e) => { const name = e.currentTarget.value; setZones((zs) => zs.map((x) => (x.key === z.key ? { ...x, name } : x))); }} />
              <ActionIcon variant="subtle" color="gray" aria-label={`Monter la zone « ${z.name} »`} disabled={i === 0} onClick={() => moveZone(i, -1)}><IconArrowUp /></ActionIcon>
              <ActionIcon variant="subtle" color="gray" aria-label={`Descendre la zone « ${z.name} »`} disabled={i === zones.length - 1} onClick={() => moveZone(i, 1)}><IconArrowDown /></ActionIcon>
              <ActionIcon variant="subtle" color="red" aria-label={`Supprimer la zone « ${z.name} »`} disabled={zones.length === 1 || zoneLocked(z.id)}
                title={zoneLocked(z.id) ? 'Une catégorie lancée s’y déroule' : undefined}
                onClick={() => (zoneCategories(z.id).length ? setDeleting(z.key) : removeZone(z.key))}><IconTrash /></ActionIcon>
            </Group>
            <Group gap="sm" data-testid="zone-disciplines">
              <Text size="xs" c="dimmed">Disciplines accueillies :</Text>
              {ALL_DISCIPLINES.map((d) => (
                <Checkbox key={d} size="xs" label={DISCIPLINES[d].label} checked={z.disciplines === null || z.disciplines.includes(d)}
                  onChange={() => toggleDiscipline(z.key, d)} />
              ))}
            </Group>
            </Stack>
          ))}
          <Group>
            <Button variant="default" size="xs" data-testid="zone-add" disabled={zones.length >= ZONE_MAX}
              onClick={() => setZones((zs) => [...zs, { key: crypto.randomUUID(), name: nextZoneName(zs.map((x) => x.name)), disciplines: null }])}>Ajouter une zone</Button>
          </Group>
          {zoneErrors.length > 0 && (
            <Alert color="red" title="Zones de combat" data-testid="zone-errors">
              <List size="sm">{zoneErrors.map((e) => <List.Item key={e}>{e}</List.Item>)}</List>
            </Alert>
          )}
          <Modal opened={deleting !== null} onClose={() => setDeleting(null)} title={`Supprimer la zone « ${deletingZone?.name ?? ''} » ?`}>
            <Stack data-testid="zone-delete-confirm">
              <Text size="sm">
                {deletingCount === 1 ? '1 catégorie de cette zone sera répartie' : `${deletingCount} catégories de cette zone seront réparties`} automatiquement sur les autres zones à l’enregistrement des réglages.
              </Text>
              <Group justify="flex-end">
                <Button variant="default" onClick={() => setDeleting(null)}>Annuler</Button>
                <Button color="red" data-testid="zone-delete-go" onClick={() => deleting && removeZone(deleting)}>Supprimer</Button>
              </Group>
            </Stack>
          </Modal>
        </Stack>
      </SectionCard>

      <SectionCard id="ordre" title={HELP['reglages.ordre'].title} help="reglages.ordre">
        <Stack>
          <Select data-testid="passage-order" w={320} label="Ordre de passage des combats" data={PASSAGE_ORDER_OPTIONS} value={s.passageOrder} allowDeselect={false}
            onChange={(v) => v && set({ passageOrder: v as PassageOrderMode })} />
          <Group align="flex-end">
            <Select data-testid="finals-zone" w={320} label="Finales sur la zone" allowDeselect={false}
              data={[{ value: '', label: 'Aucune (chaque finale reste sur sa zone)' }, ...(savedZones ?? []).map((z) => ({ value: z.id, label: z.name }))]}
              value={s.finalsZoneId ?? ''} onChange={(v) => set({ finalsZoneId: v || null })} />
            <Checkbox label="Finales de kata aussi sur cette zone" disabled={!s.finalsZoneId} checked={s.kataFinalsOnFinalsZone}
              onChange={(e) => set({ kataFinalsOnFinalsZone: e.currentTarget.checked })} data-testid="kata-finals" />
          </Group>
          <ZonesImpossibleAlert impossible={passages?.impossible} />
        </Stack>
      </SectionCard>

      <SectionCard id="reaffectation" title={HELP['reglages.recasement'].title} help="reglages.recasement">
        <Stack>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Kg testId="gap-children" label="Écart de poids max entre deux combattants — enfants" value={s.weightGapMaxKg.children}
              onChange={(children) => set({ weightGapMaxKg: { ...s.weightGapMaxKg, children } })} />
            <Kg testId="gap-adults" label="Écart de poids max entre deux combattants — adultes" value={s.weightGapMaxKg.adults}
              onChange={(adults) => set({ weightGapMaxKg: { ...s.weightGapMaxKg, adults } })} />
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
          <Switch label="Autoriser le mélange mineurs / adultes (validation manuelle)" checked={s.mixMinorsAdults}
            onChange={(e) => set({ mixMinorsAdults: e.currentTarget.checked })} />
          <Switch label="Autoriser le mélange seniors / vétérans (validation manuelle)" checked={s.mixSeniorsVeterans}
            onChange={(e) => set({ mixSeniorsVeterans: e.currentTarget.checked })} />
          <Switch label="Autoriser le mélange filles / garçons (validation manuelle)" checked={s.mixSexes.enabled}
            onChange={(e) => set({ mixSexes: { ...s.mixSexes, enabled: e.currentTarget.checked } })} />
          <Switch label="Autoriser le passage de shobu à jiyu (validation manuelle)" checked={s.shobuToJiyu} data-testid="shobu-to-jiyu"
            onChange={(e) => set({ shobuToJiyu: e.currentTarget.checked })} />
          <Switch label="Autoriser plusieurs disciplines de combat le même jour" checked={s.multipleCombatDisciplinesPerDay}
            onChange={(e) => set({ multipleCombatDisciplinesPerDay: e.currentTarget.checked })} />
          </SimpleGrid>
          {s.mixSexes.enabled && (
            <MultiSelect label="Tranches d’âge où le mélange filles / garçons est possible" data={bandOptions}
              value={s.mixSexes.ageBandCodes} onChange={(ageBandCodes) => set({ mixSexes: { ...s.mixSexes, ageBandCodes } })} />
          )}
          <Text size="sm" c="dimmed" data-testid="rules-in-replacement">L’ordre des règles et la ligne « je m’arrête ici » se règlent dans l’onglet Réaffectation.</Text>
        </Stack>
      </SectionCard>

      <SectionCard id="tableaux" title={HELP['reglages.tableaux'].title} help="reglages.tableaux">
        <Stack>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <Select label="Format pour 2 combattants" data={FORMAT_OPTIONS} value={s.formats.two} allowDeselect={false}
              onChange={(v) => v && set({ formats: { ...s.formats, two: v as CombatFormat } })} />
            <Select label="Format pour 3 combattants" data={FORMAT_OPTIONS} value={s.formats.three} allowDeselect={false}
              onChange={(v) => v && set({ formats: { ...s.formats, three: v as CombatFormat } })} />
            <Select label="Format pour 4 et plus" data={FORMAT_OPTIONS} value={s.formats.fourPlus} allowDeselect={false}
              onChange={(v) => v && set({ formats: { ...s.formats, fourPlus: v as CombatFormat } })} />
          </SimpleGrid>
          <Checkbox label="Repêchage" checked={s.repechage} onChange={(e) => set({ repechage: e.currentTarget.checked })} />
          <Checkbox label="Combat pour la 3e place" checked={s.thirdPlaceMatch}
            onChange={(e) => set({ thirdPlaceMatch: e.currentTarget.checked })} />
        </Stack>
      </SectionCard>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        <SectionCard id="pesee" title={HELP['reglages.pesee'].title} help="reglages.pesee">
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Kg label="Tolérance — hommes" value={s.weighInToleranceKg.M}
              onChange={(M) => set({ weighInToleranceKg: { ...s.weighInToleranceKg, M } })} />
            <Kg label="Tolérance — femmes" value={s.weighInToleranceKg.F}
              onChange={(F) => set({ weighInToleranceKg: { ...s.weighInToleranceKg, F } })} />
          </SimpleGrid>
        </SectionCard>

        <SectionCard id="kata" title={HELP['reglages.kata'].title} help="reglages.kata">
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select label="Médailles de bronze en kata" data={[{ value: '1', label: '1' }, { value: '2', label: '2' }]}
              value={String(s.kataBronzeCount)} allowDeselect={false}
              onChange={(v) => v && set({ kataBronzeCount: Number(v) as 1 | 2 })} />
            <Select label="Rounds de triathlon" data={[{ value: '3', label: '3 (1 par discipline)' }, { value: '6', label: '6 (2 par discipline)' }]}
              value={String(s.triathlonRounds)} allowDeselect={false}
              onChange={(v) => v && set({ triathlonRounds: Number(v) as 3 | 6 })} />
          </SimpleGrid>
        </SectionCard>

      </SimpleGrid>
      <ApiErrorAlert error={saveZones.error ?? update.error} />
      {/* Barre d'enregistrement collée en bas : un seul « Enregistrer » pour toutes les sections au-dessus. */}
      <Group justify="space-between" className="no-print" data-testid="settings-save-bar"
        style={{ position: 'sticky', bottom: 0, zIndex: 50, padding: 'var(--mantine-spacing-sm) var(--mantine-spacing-md)', background: 'var(--sk-bar)', border: '1px solid var(--sk-card-line)', borderRadius: 'var(--mantine-radius-lg)' }}>
        {dirty ? <StatusBadge tone="warn" data-testid="settings-unsaved">Modifications non enregistrées</StatusBadge> : <Text size="sm" c="dimmed">Aucune modification en cours</Text>}
        <Button data-testid="settings-save" onClick={save} loading={saveZones.isPending || update.isPending}>
          Enregistrer
        </Button>
      </Group>

      <SectionCard id="echanges" title={HELP['reglages.echanges'].title} help="reglages.echanges">
        <SyncPanel competitionId={id} />
      </SectionCard>
    </Stack>
  );
}
