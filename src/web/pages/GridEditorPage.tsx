import {
  ActionIcon, Button, Checkbox, Group, NumberInput, SegmentedControl, Select, SimpleGrid, Stack, Table, Text, TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import type { AgeLinkKind, CategoryGrid, Sex, WeightClass } from '../../domain/types.js';
import { parseWeightLabel } from '../../domain/weights.js';
import { ApiError, useGrid, useGridTemplates, useLoadTemplate, useReplaceGrid, useSaveTemplate } from '../api.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { OpenCategoriesMatrix } from '../components/OpenCategoriesMatrix.js';
import { IconTrash } from '../components/ui/icons.js';
import { SectionCard } from '../components/ui/SectionCard.js';
import { StatusBadge } from '../components/ui/StatusBadge.js';
import { useUnsaved } from '../unsaved.js';
import { HELP } from '../help.js';

const AGE_LINK_KINDS = [
  { value: 'C', label: 'Toujours permis' },
  { value: 'D', label: 'Seulement si le mélange seniors / vétérans est activé' },
];

const byWeight = (a: number | null, b: number | null) => (a ?? Infinity) - (b ?? Infinity);

/** Libellés normalisés, catégorie ouverte renommée « +X » (X = limite la plus haute), ordre recalculé. */
function normalizeWeightClasses(classes: WeightClass[]): WeightClass[] {
  const parsed = classes.map((w) => {
    const p = parseWeightLabel(w.label)!;
    return { ...w, label: p.label, maxKg: p.maxKg };
  });
  const groups = new Map<string, WeightClass[]>();
  for (const w of parsed) groups.set(`${w.ageBandCode}|${w.sex}`, [...(groups.get(`${w.ageBandCode}|${w.sex}`) ?? []), w]);
  for (const group of groups.values()) {
    group.sort((a, b) => byWeight(a.maxKg, b.maxKg)).forEach((w, i) => (w.sortOrder = i));
    const limits = group.map((w) => w.maxKg).filter((kg): kg is number => kg !== null);
    const open = group.find((w) => w.maxKg === null);
    if (open && limits.length) open.label = `+${Math.max(...limits)}`;
  }
  return parsed;
}

export function GridEditorPage() {
  const { id = '' } = useParams();
  const { data } = useGrid(id);
  const replace = useReplaceGrid(id);
  const [grid, setGrid] = useState<CategoryGrid | null>(null);
  const [band, setBand] = useState<string | null>(null);
  const [sex, setSex] = useState<Sex>('F');
  const [localError, setLocalError] = useState<ApiError | null>(null);
  const { data: templates = [] } = useGridTemplates();
  const saveTemplate = useSaveTemplate(id);
  const loadTemplate = useLoadTemplate(id);
  const [templateName, setTemplateName] = useState('');
  const [templateId, setTemplateId] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      setGrid(structuredClone(data));
      setBand((b) => b ?? data.ageBands[0]?.code ?? null);
    }
  }, [data]);
  // Saisie en cours : la mise à jour automatique (autre poste) attend, et quitter l'onglet demande confirmation.
  const dirty = !!data && !!grid && JSON.stringify(grid) !== JSON.stringify(data);
  useUnsaved('grille', dirty);

  const rows = useMemo(
    () =>
      (grid?.weightClasses ?? [])
        .map((w, index) => ({ w, index }))
        .filter(({ w }) => w.ageBandCode === band && w.sex === sex)
        // Ordre stable pendant la frappe : le tri par poids est refait à l'enregistrement.
        .sort((a, b) => a.w.sortOrder - b.w.sortOrder),
    [grid, band, sex],
  );

  if (!grid) return null;
  const bandOptions = grid.ageBands.map((b) => ({ value: b.code, label: b.label }));

  const setLabel = (index: number, label: string) => {
    const next = structuredClone(grid);
    const parsed = parseWeightLabel(label);
    next.weightClasses[index] = { ...next.weightClasses[index]!, label, maxKg: parsed ? parsed.maxKg : next.weightClasses[index]!.maxKg };
    setGrid(next);
  };
  const removeClass = (index: number) => setGrid({ ...grid, weightClasses: grid.weightClasses.filter((_, i) => i !== index) });
  const addClass = () => {
    if (!band) return;
    const limits = rows.map((r) => r.w.maxKg).filter((kg): kg is number => kg !== null);
    const kg = (limits.length ? Math.max(...limits) : 20) + 5;
    setGrid({ ...grid, weightClasses: [...grid.weightClasses, { id: crypto.randomUUID(), ageBandCode: band, sex, label: `-${kg}`, maxKg: kg, sortOrder: rows.length }] });
  };
  const updateBand = (code: string, patch: Partial<CategoryGrid['ageBands'][number]>) =>
    setGrid({ ...grid, ageBands: grid.ageBands.map((b) => (b.code === code ? { ...b, ...patch } : b)) });

  const save = () => {
    const invalid = grid.weightClasses.filter((w) => !parseWeightLabel(w.label));
    if (invalid.length) {
      setLocalError(new ApiError(400, 'Données invalides', invalid.map((w) => `Libellé de poids incompréhensible : « ${w.label} »`)));
      return;
    }
    setLocalError(null);
    const normalized: CategoryGrid = { ...grid, weightClasses: normalizeWeightClasses(grid.weightClasses) };
    replace.mutate(normalized, { onSuccess: () => notifications.show({ color: 'green', message: 'Grille enregistrée' }) });
  };

  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="lg">
      <SectionCard title={HELP['grille.poids'].title} help="grille.poids">
        <Stack>
          <Group>
            <Select data-testid="grid-age-select" label="Tranche d’âge" data={bandOptions} value={band} allowDeselect={false} onChange={setBand} />
            <div>
              <Text size="sm" fw={500} mb={4}>Sexe</Text>
              <SegmentedControl data-testid="grid-sex-select" value={sex} onChange={(v) => setSex(v as Sex)}
                data={[{ value: 'F', label: 'Féminines' }, { value: 'M', label: 'Masculins' }]} />
            </div>
          </Group>
          <Table className="sk-cell">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Libellé (ex. -35 ou +65)</Table.Th>
                <Table.Th ta="right">Poids max</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map(({ w, index }) => (
                <Table.Tr key={index}>
                  <Table.Td>
                    <TextInput data-testid="weight-label-input" aria-label="Libellé" value={w.label}
                      onChange={(e) => setLabel(index, e.currentTarget.value)}
                      error={parseWeightLabel(w.label) ? undefined : 'Libellé incompréhensible'} />
                  </Table.Td>
                  <Table.Td ta="right" className="num" c={w.maxKg === null ? 'dimmed' : undefined}>{w.maxKg === null ? 'ouverte' : `${w.maxKg} kg`}</Table.Td>
                  <Table.Td ta="right">
                    <ActionIcon variant="subtle" color="red" aria-label="Supprimer" title="Supprimer" onClick={() => removeClass(index)}><IconTrash /></ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Group>
            <Button variant="default" onClick={addClass}>Ajouter une catégorie</Button>
          </Group>
        </Stack>
      </SectionCard>

      <SectionCard title={HELP['grille.tranches'].title} help="grille.tranches">
        <Table className="sk-cell">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Libellé</Table.Th>
              <Table.Th>Âge min</Table.Th>
              <Table.Th>Âge max</Table.Th>
              <Table.Th>Mineurs</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {grid.ageBands.map((b) => (
              <Table.Tr key={b.code}>
                <Table.Td><TextInput aria-label="Libellé" value={b.label} onChange={(e) => updateBand(b.code, { label: e.currentTarget.value })} /></Table.Td>
                <Table.Td><NumberInput aria-label="Âge min" w={90} value={b.minAge} onChange={(v) => updateBand(b.code, { minAge: Number(v) })} /></Table.Td>
                <Table.Td>
                  <NumberInput aria-label="Âge max" w={90} value={b.maxAge ?? ''} placeholder="—"
                    onChange={(v) => updateBand(b.code, { maxAge: v === '' ? null : Number(v) })} />
                </Table.Td>
                <Table.Td><Checkbox aria-label="Mineurs" checked={b.isMinor} onChange={(e) => updateBand(b.code, { isMinor: e.currentTarget.checked })} /></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </SectionCard>

      </SimpleGrid>

      {data && (
        <SectionCard title={HELP['grille.ouvertes'].title} help="grille.ouvertes">
          <OpenCategoriesMatrix competitionId={id} grid={data} />
        </SectionCard>
      )}

      <SectionCard title={HELP['grille.passages'].title} help="grille.passages">
        <Stack>
          {grid.ageLinks.map((l, i) => (
            <Group key={i} wrap="wrap">
              <Select aria-label="De" w={160} data={bandOptions} value={l.from} allowDeselect={false}
                onChange={(v) => v && setGrid({ ...grid, ageLinks: grid.ageLinks.map((x, j) => (j === i ? { ...x, from: v } : x)) })} />
              <Text>→</Text>
              <Select aria-label="Vers" w={160} data={bandOptions} value={l.to} allowDeselect={false}
                onChange={(v) => v && setGrid({ ...grid, ageLinks: grid.ageLinks.map((x, j) => (j === i ? { ...x, to: v } : x)) })} />
              <Select aria-label="Type de passage" w={420} data={AGE_LINK_KINDS} value={l.kind} allowDeselect={false}
                onChange={(v) => v && setGrid({ ...grid, ageLinks: grid.ageLinks.map((x, j) => (j === i ? { ...x, kind: v as AgeLinkKind } : x)) })} />
              <ActionIcon variant="subtle" color="red" aria-label="Supprimer"
                title="Supprimer" onClick={() => setGrid({ ...grid, ageLinks: grid.ageLinks.filter((_, j) => j !== i) })}><IconTrash /></ActionIcon>
            </Group>
          ))}
          <Group>
            <Button variant="default"
              onClick={() => setGrid({ ...grid, ageLinks: [...grid.ageLinks, { from: grid.ageBands[0]!.code, to: grid.ageBands[1]!.code, kind: 'C' }] })}>
              Ajouter un passage
            </Button>
          </Group>
        </Stack>
      </SectionCard>

      <ApiErrorAlert error={localError ?? replace.error ?? saveTemplate.error ?? loadTemplate.error} />
      {/* Barre d'enregistrement collée en bas, comme dans les réglages. */}
      <Group justify="space-between" className="no-print"
        style={{ position: 'sticky', bottom: 0, zIndex: 50, padding: 'var(--mantine-spacing-sm) var(--mantine-spacing-md)', background: 'var(--sk-bar)', border: '1px solid var(--sk-card-line)', borderRadius: 'var(--mantine-radius-lg)' }}>
        {dirty ? <StatusBadge tone="warn" data-testid="grid-unsaved">Modifications non enregistrées</StatusBadge> : <Text size="sm" c="dimmed">Aucune modification en cours</Text>}
        <Button data-testid="grid-save" onClick={save} loading={replace.isPending}>Enregistrer la grille</Button>
      </Group>
      <SectionCard title={HELP['grille.modeles'].title} help="grille.modeles">
        <Group align="flex-end">
          <TextInput label="Nom du modèle" placeholder="ex. Grille shidokan 2026" value={templateName} onChange={(e) => setTemplateName(e.currentTarget.value)} />
          <Button variant="default" data-testid="template-save" disabled={!templateName.trim()}
            onClick={() => saveTemplate.mutate(templateName.trim(), { onSuccess: () => { setTemplateName(''); notifications.show({ color: 'green', message: 'Modèle enregistré (grille déjà enregistrée).' }); } })}>
            Enregistrer comme modèle
          </Button>
          <Select label="Charger un modèle" data={templates.map((t) => ({ value: t.id, label: t.name }))} value={templateId} onChange={setTemplateId} />
          <Button variant="default" disabled={!templateId} data-testid="template-load"
            onClick={() => templateId && loadTemplate.mutate(templateId, { onSuccess: () => notifications.show({ color: 'green', message: 'Modèle chargé.' }) })}>
            Charger
          </Button>
        </Group>
      </SectionCard>
    </Stack>
  );
}
