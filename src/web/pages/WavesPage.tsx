import { ActionIcon, Alert, Button, Card, Chip, Group, List, Modal, NativeSelect, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { activeEntrantCount, type Category } from '../../domain/categories.js';
import { DISCIPLINES } from '../../domain/disciplines.js';
import type { DisciplineId } from '../../domain/types.js';
import { validateWaves, WAVE_MAX, WAVE_NONE, waveConflicts, waveOfCategory, type Wave, type WaveRules } from '../../domain/waves.js';
import { useCategories, useGrid, useSaveWaves, useUpdateCategory, useWaves } from '../api.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { IconArrowDown, IconArrowUp, IconTrash } from '../components/ui/icons.js';
import { SectionCard } from '../components/ui/SectionCard.js';
import { StatusBadge } from '../components/ui/StatusBadge.js';
import { HELP } from '../help.js';
import { plural } from '../../domain/plural.js';
import { useUnsaved } from '../unsaved.js';

/** Vague en cours d'édition ; `key` identifie aussi une vague pas encore enregistrée. */
interface Draft { key: string; id?: string; name: string; rules: WaveRules }

const DISCIPLINE_LIST = Object.entries(DISCIPLINES) as [DisciplineId, { label: string }][];
const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** « Tout cocher » / « Tout décocher » d'une liste de cases. */
function AllToggle({ all, onChange, testId }: { all: boolean; onChange: (all: boolean) => void; testId: string }) {
  return (
    <Button size="compact-xs" variant="subtle" data-testid={testId} onClick={() => onChange(!all)}>
      {all ? 'Tout décocher' : 'Tout cocher'}
    </Button>
  );
}

export function WavesPage() {
  const { id = '' } = useParams();
  const { data: grid } = useGrid(id);
  const { data: saved } = useWaves(id);
  const { data: categories = [] } = useCategories(id);
  const save = useSaveWaves(id);
  const updateCategory = useUpdateCategory(id);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  useEffect(() => {
    if (saved) setDrafts(saved.map((w) => ({ key: w.id, id: w.id, name: w.name, rules: w.rules })));
  }, [saved]);

  // Modifications non enregistrées (noms, ordre, règles) : signalées, et confirmation avant de quitter l'onglet.
  const comparable = (ws: { id?: string; name: string; rules: WaveRules }[]) => JSON.stringify(ws.map(({ id: wid, name, rules }) => [wid ?? null, name, rules]));
  const dirty = !!saved && comparable(drafts) !== comparable(saved);
  useUnsaved('waves', dirty);

  // Aperçu immédiat : la vague de chaque catégorie est recalculée avec les vagues en cours d'édition.
  const editing: Wave[] = drafts.map((d, order) => ({ id: d.id ?? d.key, name: d.name, order, rules: d.rules, weighInClosed: false }));
  const listed = categories.filter((c) => c.registrationIds.length > 0);
  const waveOf = (c: Category) => (grid ? waveOfCategory({ key: c.key, waveOverride: c.waveOverride, waveBands: c.waveBands }, editing, grid) : null);
  const conflicts = useMemo(
    () => (grid ? waveConflicts(listed.map((c) => ({ id: c.id, key: c.key, waveOverride: c.waveOverride, waveBands: c.waveBands })), editing, grid) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grid, categories, drafts],
  );
  if (!grid) return null;

  const setDraft = (key: string, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const move = (i: number, d: -1 | 1) =>
    setDrafts((ds) => {
      const next = [...ds];
      [next[i], next[i + d]] = [next[i + d]!, next[i]!];
      return next;
    });
  const remove = (key: string) => {
    setDrafts((ds) => ds.filter((d) => d.key !== key));
    setDeleting(null);
  };
  const deletingDraft = drafts.find((d) => d.key === deleting);
  const deletingCount = deletingDraft ? listed.filter((c) => waveOf(c) === (deletingDraft.id ?? deletingDraft.key)).length : 0;
  const waiting = listed.filter((c) => waveOf(c) === null);
  const savedWaves = saved ?? [];
  const nameOf = (waveId: string) => editing.find((w) => w.id === waveId)?.name ?? '';
  const override = (c: Category, waveOverride: string | null) => updateCategory.mutate({ cid: c.id, waveOverride });

  const doSave = () => {
    const input = drafts.map(({ id: wid, name, rules }) => (wid ? { id: wid, name, rules } : { name, rules }));
    const errs = validateWaves(input);
    setErrors(errs);
    if (errs.length) return;
    save.mutate({ waves: input, knownIds: savedWaves.map((w) => w.id) }, { onSuccess: () => notifications.show({ color: 'green', message: 'Sessions enregistrées' }) });
  };

  const categoryRow = (c: Category, actions: React.ReactNode, testid: string) => (
    <Group key={c.id} justify="space-between" wrap="nowrap" data-testid={testid} py={6} style={{ borderTop: '1px solid var(--sk-line)' }}>
      <Group gap={6} wrap="wrap" style={{ minWidth: 0 }}>
        <Text size="sm" fw={500}>{c.label}</Text>
        <Text span size="xs" c="dimmed" className="num">{plural(activeEntrantCount(c), 'inscrit')}</Text>
        {c.waveOverride && c.waveOverride !== WAVE_NONE && <StatusBadge tone="accent" size="sm">Ajoutée à la main</StatusBadge>}
      </Group>
      <Group gap={4} wrap="nowrap">{actions}</Group>
    </Group>
  );

  return (
    <Stack gap="lg">
      {drafts.length === 0 && (
        <Alert color="blue" data-testid="waves-none">
          Aucune session : toutes les catégories forment une seule session (une seule pesée, une seule réaffectation). Créez des sessions pour peser et lancer les catégories par groupes.
        </Alert>
      )}
      {conflicts.length > 0 && (
        <Alert color="orange" title="Catégories prises par plusieurs sessions" data-testid="waves-conflicts">
          <List size="sm">
            {conflicts.map((x) => {
              const c = listed.find((k) => k.id === x.categoryId)!;
              return <List.Item key={x.categoryId}>{c.label} correspond aux règles de {x.waveIds.map(nameOf).join(' et ')} : placée dans {nameOf(x.waveIds[0]!)}.</List.Item>;
            })}
          </List>
        </Alert>
      )}
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        {drafts.map((d, i) => {
          const waveId = d.id ?? d.key;
          const cats = listed.filter((c) => waveOf(c) === waveId);
          return (
            <Card key={d.key} withBorder data-testid="wave-card" padding="lg">
              <Stack gap="sm">
                <Group gap="xs" wrap="nowrap">
                  <TextInput data-testid="wave-name" aria-label={`Nom de la session ${i + 1}`} value={d.name} maxLength={40} style={{ flex: 1 }} className="sk-cell"
                    styles={{ input: { fontWeight: 700, fontSize: 'var(--mantine-font-size-lg)' } }}
                    onChange={(e) => setDraft(d.key, { name: e.currentTarget.value })} />
                  <ActionIcon variant="subtle" color="gray" aria-label={`Monter la session « ${d.name} »`} disabled={i === 0} onClick={() => move(i, -1)}><IconArrowUp /></ActionIcon>
                  <ActionIcon variant="subtle" color="gray" aria-label={`Descendre la session « ${d.name} »`} disabled={i === drafts.length - 1} onClick={() => move(i, 1)}><IconArrowDown /></ActionIcon>
                  <ActionIcon variant="subtle" color="red" aria-label={`Supprimer la session « ${d.name} »`}
                    onClick={() => (cats.length ? setDeleting(d.key) : remove(d.key))}><IconTrash /></ActionIcon>
                </Group>
                <Group gap="xs">
                  <Text size="xs" fw={600}>Tranches d’âge</Text>
                  <AllToggle testId="wave-all-ages" all={grid.ageBands.every((b) => d.rules.ageBandCodes.includes(b.code))}
                    onChange={(all) => setDraft(d.key, { rules: { ...d.rules, ageBandCodes: all ? grid.ageBands.map((b) => b.code) : [] } })} />
                </Group>
                <Group gap={4}>
                  {grid.ageBands.map((b) => (
                    <Chip key={b.code} size="xs" checked={d.rules.ageBandCodes.includes(b.code)}
                      onChange={() => setDraft(d.key, { rules: { ...d.rules, ageBandCodes: toggle(d.rules.ageBandCodes, b.code) } })}>{b.label}</Chip>
                  ))}
                </Group>
                <Group gap="xs">
                  <Text size="xs" fw={600}>Disciplines <Text span size="xs" c="dimmed">(aucune cochée : toutes)</Text></Text>
                  <AllToggle testId="wave-all-disciplines" all={DISCIPLINE_LIST.every(([code]) => d.rules.disciplines.includes(code))}
                    onChange={(all) => setDraft(d.key, { rules: { ...d.rules, disciplines: all ? DISCIPLINE_LIST.map(([code]) => code) : [] } })} />
                </Group>
                <Group gap={4}>
                  {DISCIPLINE_LIST.map(([code, dsc]) => (
                    <Chip key={code} size="xs" checked={d.rules.disciplines.includes(code)}
                      onChange={() => setDraft(d.key, { rules: { ...d.rules, disciplines: toggle(d.rules.disciplines, code) } })}>{dsc.label}</Chip>
                  ))}
                </Group>
                <Text size="xs" fw={600} mt="xs">{cats.length === 0 ? 'Aucune catégorie : cochez des tranches d’âge.' : plural(cats.length, 'catégorie')}</Text>
                <Stack gap={0}>
                {cats.map((c) =>
                  categoryRow(
                    c,
                    <>
                      {c.waveOverride && c.waveOverride !== WAVE_NONE && (
                        <Button size="compact-xs" variant="subtle" onClick={() => override(c, null)}>Revenir aux règles</Button>
                      )}
                      <Button size="compact-xs" variant="subtle" color="red" onClick={() => override(c, WAVE_NONE)}>Retirer</Button>
                    </>,
                    'wave-category',
                  ),
                )}
                </Stack>
              </Stack>
            </Card>
          );
        })}
      </SimpleGrid>
      <Group>
        <Button variant="default" data-testid="wave-add" disabled={drafts.length >= WAVE_MAX}
          onClick={() => setDrafts((ds) => [...ds, { key: crypto.randomUUID(), name: `Session ${ds.length + 1}`, rules: { ageBandCodes: [], disciplines: [] } }])}>
          Ajouter une session
        </Button>
      </Group>
      {/* Barre d'enregistrement collée en bas, comme dans les réglages. */}
      <Group justify="space-between" className="no-print"
        style={{ position: 'sticky', bottom: 0, zIndex: 50, padding: 'var(--mantine-spacing-sm) var(--mantine-spacing-md)', background: 'var(--sk-bar)', border: '1px solid var(--sk-card-line)', borderRadius: 'var(--mantine-radius-lg)' }}>
        {dirty ? <StatusBadge tone="warn" data-testid="waves-unsaved">Modifications non enregistrées</StatusBadge> : <Text size="sm" c="dimmed">Aucune modification en cours</Text>}
        <Button data-testid="wave-save" onClick={doSave} loading={save.isPending}>Enregistrer les sessions</Button>
      </Group>
      {errors.length > 0 && (
        <Alert color="red" title="Sessions" data-testid="wave-errors">
          <List size="sm">{errors.map((e) => <List.Item key={e}>{e}</List.Item>)}</List>
        </Alert>
      )}
      <ApiErrorAlert error={save.error ?? updateCategory.error} />

      <SectionCard data-testid="waves-waiting" title={`${HELP['vagues.en-attente'].title} (${waiting.length})`} help="vagues.en-attente">
        {waiting.length === 0 ? (
          <Text size="sm" c="dimmed">Aucune catégorie en attente.</Text>
        ) : (
          <Stack gap={0}>
            {waiting.map((c) =>
              categoryRow(
                c,
                <>
                  {c.waveOverride === WAVE_NONE && (
                    <Button size="compact-xs" variant="subtle" onClick={() => override(c, null)}>Revenir aux règles</Button>
                  )}
                  <NativeSelect size="xs" aria-label={`Ajouter ${c.label} à une session`} value=""
                    data={[{ value: '', label: 'Ajouter à…' }, ...savedWaves.map((w) => ({ value: w.id, label: w.name }))]}
                    onChange={(e) => e.currentTarget.value && override(c, e.currentTarget.value)} />
                </>,
                'waiting-category',
              ),
            )}
          </Stack>
        )}
      </SectionCard>

      <Modal opened={deleting !== null} onClose={() => setDeleting(null)} title={`Supprimer la session « ${deletingDraft?.name ?? ''} » ?`}>
        <Stack data-testid="wave-delete-confirm">
          <Text size="sm">
            {deletingCount === 1 ? '1 catégorie' : `${deletingCount} catégories`} quitteront cette session à l’enregistrement : elles suivront les règles des autres sessions, ou passeront en attente.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleting(null)}>Annuler</Button>
            <Button color="red" data-testid="wave-delete-go" onClick={() => deleting && remove(deleting)}>Supprimer</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
