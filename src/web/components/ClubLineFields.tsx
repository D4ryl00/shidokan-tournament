import { Alert, Badge, Box, Checkbox, Chip, Group, Input, NativeSelect, Paper, Radio, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { Children, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { fieldPatch, type ImportField } from '../../domain/club-form-plan.js';
import { choosePref, kgText, orderedPrefs, weightWarning, type ClubFormLine, type PrefDiscipline, type PrefRank } from '../../domain/club-form.js';
import { DISCIPLINES } from '../../domain/disciplines.js';
import { FIELD_LABELS, type FfkCardValue, type FfkField } from '../../domain/ffk-plan/values.js';
import type { DisciplineId } from '../../domain/types.js';
import { ageBandChoices, applyChange, combatChoices, deriveAfterAgeChange, kataChoice, reclassChoices, rulesetChoices, toggleCombat, type LineFormContext } from './club-line/lineForm.js';
import { cardFieldValue, decisionZone, pendingDecisions, type DecisionZone, type FieldDiff } from './club-line/decisions.js';
import { FfkChoice } from './club-line/FfkChoice.js';
import { choiceValues, ffkChoiceState, ffkValueAvailable, hiddenConflicts, importValueText, type FfkFormStep } from './club-line/ffkStep.js';
import { OneOf } from './PaperEntryTable.js';

export { pendingDecisions, type FieldDiff };

const ZONE_STYLE: Record<'decide' | 'decided', CSSProperties> = {
  decide: { border: '1px solid var(--mantine-color-orange-6)', background: 'var(--mantine-color-orange-light)', borderRadius: 10, padding: '10px 12px' },
  decided: { border: '1px solid var(--mantine-color-blue-6)', borderRadius: 10, padding: '10px 12px' },
};

const parseKg = (raw: string): number | null => {
  const kg = Number(raw.replace(',', '.'));
  return raw.trim() && kg > 0 ? kg : null;
};

/**
 * Les champs du combattant : ceux de la fenêtre « Ajouter / Modifier un combattant » (`ClubLineForm`, qui les met dans
 * sa `Modal`) et ceux d'une carte ouverte de l'import FFK, en ligne dans la page.
 *
 * Deux usages :
 * - fenêtre de l'import PDF / ODS (`step` fourni) : marques « FFK », aides, cases « FFK » / « Votre fiche » sous les champs
 *   en désaccord, comme avant ; pas de zones de décision ;
 * - carte de l'import FFK (`step` absent) : chaque champ en écart est encadré (`data-zone="decide"`, « À choisir », tant
 *   qu'il est vide ; `"decided"`, « Choisi », une fois rempli), avec en tête « N choix à faire… ».
 *
 * Verrous : ils ne viennent que de `disabled` (combats commencés, inscriptions closes). La fenêtre les tire de la ligne
 * enregistrée ; la carte d'import passe ceux du combattant choisi (editable / partlyEditable / startedDisciplines) : pour un
 * même combattant, on peut modifier exactement ce que la fenêtre permet (le serveur garde de toute façon les disciplines
 * commencées et refuse une ligne verrouillée). Sans `disabled`, tous les champs sont modifiables.
 */
export function ClubLineFields({ value, onChange, ctx, diffs, clubs, showLicenceHint, weightIssue, disabled, oneCombatPerDay, step, lastNameRef, autoFocus }: {
  value: FfkCardValue;
  onChange: (v: FfkCardValue) => void;
  ctx: LineFormContext;
  diffs: FieldDiff[];
  /** Fourni (carte d'import) : un champ « Club » cherchable. */
  clubs?: { value: string; label: string }[];
  /** « Laissée vide, la licence déjà enregistrée est gardée. » sous le N° de licence. */
  showLicenceHint: boolean;
  /** Catégorie de poids illisible ou hors grille dans l'export : à choisir dans la grille. */
  weightIssue?: string | null;
  disabled?: { locked: boolean; partly: boolean; started: DisciplineId[] };
  /** Le réglage de la compétition ne prévoit qu'un combat par jour : avis à l'organisateur qui en coche plusieurs. */
  oneCombatPerDay?: boolean;
  /** Fenêtre de l'import PDF / ODS : marques, aides et titres des cases ; la tranche d'âge choisie y déduit le poids et le Jiyu. */
  step?: Pick<FfkFormStep, 'marks' | 'hints' | 'switchHint' | 'labels'>;
  lastNameRef?: Ref<HTMLInputElement>;
  /** Curseur sur le nom à l'ouverture (fenêtre de création). */
  autoFocus?: boolean;
}) {
  const form = value.line;
  const { mode, ageBands, weightClasses } = ctx;
  // Texte tapé dans « Poids actuel » ; s'il ne dit plus la valeur (case FFK cliquée, modifications annulées…), on montre la valeur.
  const [weightText, setWeightText] = useState(form.weightKg != null ? kgText(form.weightKg) : '');
  const weight = parseKg(weightText) === form.weightKg ? weightText : form.weightKg != null ? kgText(form.weightKg) : '';

  // Ligne verrouillée (combats commencés…) : l'organisateur y corrige encore le nom, le prénom, le grade, le nom masqué et
  // les disciplines qui n'ont pas commencé (`partly`) ; sans combat commencé (kata seul), aussi le poids, le règlement et le reclassement.
  const locked = !!disabled?.locked;
  const partly = locked && !!disabled?.partly;
  const frozen = locked && !partly;
  const started = new Set(partly ? disabled!.started : []);
  const combatFrozen = frozen || [...started].some((d) => d !== 'kata');

  // Import (fenêtre) d'une fiche renvoyée : la tranche d'âge choisie déduit la catégorie de poids et le Jiyu d'un mineur.
  // Pas dans une carte : rien n'y est rempli d'office.
  const set = (patch: Partial<ClubFormLine>) => {
    const next = applyChange(form, patch, ctx);
    onChange({ ...value, line: step ? deriveAfterAgeChange(next, patch, ctx) : next });
  };
  const band = ageBands.find((b) => b.code === form.ageBandCode);
  const classes = weightClasses.filter((w) => w.ageBandCode === form.ageBandCode && w.sex === form.sex);
  const warning = weightWarning(form, weightClasses);
  const hasCombat = form.combats.length > 0;
  const combats = combatChoices(form, ctx);
  const rulesets = rulesetChoices(form, ctx);
  const kata = kataChoice(form, ctx);
  const otherChoices = reclassChoices(form, ctx);
  const chosen = orderedPrefs(form.prefs);
  // Un rang de plus s'affiche quand le précédent est choisi et qu'il reste une discipline à proposer.
  const shownRanks = ([1, 2, 3] as PrefRank[]).filter((rank) => rank === 1 || (chosen.length >= rank - 1 && otherChoices.length >= rank));
  const ownLabel = form.combats.map((c) => DISCIPLINES[c].label.toLowerCase()).join(' et ');
  const nothingOpen = mode === 'coach' && !!band && !!form.sex && combats.length === 0 && !kata.shown;

  // Zones de décision : carte d'import seulement.
  const zones = !step;
  const zoneOf = (field: FfkField): DecisionZone => (zones ? decisionZone(field, diffs, value, weightIssue) : null);
  const pending = zones ? pendingDecisions(diffs, value, weightIssue) : 0;
  const tag = (field: FfkField) => {
    const z = zoneOf(field);
    return z && (
      <Badge component="span" size="xs" ml={6} variant={z === 'decide' ? 'filled' : 'light'} color={z === 'decide' ? 'orange' : 'blue'} data-testid={`zone-tag-${field}`}>
        {z === 'decide' ? 'À choisir' : 'Choisi'}
      </Badge>
    );
  };
  /** Encadre un champ en écart (et ses cases FFK / Fiche club) ; sans écart, le champ tel quel. `ownTag` : le champ n'a pas d'étiquette où mettre « À choisir ». */
  const zoneBox = (field: FfkField, children: ReactNode, ownTag = false) => {
    const z = zoneOf(field);
    if (!z) return children;
    return (
      <Box data-zone={z} data-testid={`zone-${field}`} style={ZONE_STYLE[z]}>
        <Stack gap={4}>{ownTag && <div>{tag(field)}</div>}{children}</Stack>
      </Box>
    );
  };

  // Fenêtre de l'import : marque « FFK » à côté d'une étiquette, aide sous un champ.
  const mark = (key: FfkFormStep['marks'][number]) => step?.marks.includes(key) && <Badge variant="outline" size="xs" ml={6} data-testid={`ffk-mark-${key}`}>FFK</Badge>;
  const labelled = (text: string, key: FfkFormStep['marks'][number] | null, field: FfkField) => <>{text}{key && mark(key)}{tag(field)}</>;
  const hint = (key: keyof FfkFormStep['hints']) => (step?.hints[key] ? <Text size="xs" c="dimmed" style={{ whiteSpace: 'pre-line' }} data-testid={`ffk-hint-${key}`}>{step.hints[key]}</Text> : null);
  const DISABLED: Record<FfkField, boolean> = {
    lastName: frozen, firstName: frozen, sex: locked, ageBandCode: locked, disciplines: frozen, grade: frozen, weightClassId: combatFrozen, weightKg: combatFrozen, ruleset: combatFrozen, prefs: combatFrozen, shobuKeep: combatFrozen, licence: false, clubId: frozen,
  };
  const clubLabel = (id: string | null) => (id == null ? '—' : clubs?.find((c) => c.value === id)?.label ?? id);
  const choice = (field: FfkField) => {
    const diff = diffs.find((d) => d.field === field);
    if (!diff) return null;
    const options = field === 'ageBandCode' ? ageBandChoices(form, ctx).map((o) => o.value)
      : field === 'weightClassId' ? classes.map((w) => w.id) : field === 'ruleset' ? rulesets.map(([r]) => r)
      : field === 'clubId' && clubs ? clubs.map((c) => c.value) : null;
    const labels = step ? (step.labels ?? { imported: 'FFK', saved: 'Votre fiche' }) : { imported: 'FFK', saved: 'Fiche club' };
    // Disciplines commencées : le formulaire les garde cochées, les cases aussi ; plus rien à choisir si elles étaient la seule différence.
    const values = field === 'clubId' ? { imported: diff.ffk, saved: diff.fiche } : choiceValues({ ...diff, field }, [...started]);
    if (!values) return null;
    const { imported, saved } = values;
    const text = (v: string | null) => (field === 'clubId' ? clubLabel(v) : importValueText(field, v, ctx));
    const pick = (v: string | null) => (field === 'clubId' ? onChange({ ...value, clubId: v }) : set(fieldPatch(field, v)));
    return (
      <FfkChoice label={FIELD_LABELS[field]} state={ffkChoiceState(cardFieldValue(value, field), { ffk: imported, fiche: saved })} ffk={text(imported)} fiche={text(saved)} disabled={DISABLED[field]}
        titles={{ ffk: labels.imported, fiche: diff.savedLabel ?? labels.saved }} pending={zoneOf(field) === 'decide'}
        unavailable={options ? { ffk: !ffkValueAvailable(diff.ffk, options), fiche: !ffkValueAvailable(diff.fiche, options) } : undefined}
        onPick={(which) => pick(which === 'ffk' ? imported : saved)} />
    );
  };

  const importDiffs = diffs.filter((d): d is FieldDiff & { field: ImportField } => d.field !== 'clubId');
  const elsewhere = hiddenConflicts(importDiffs, { reclassShown: hasCombat && otherChoices.length > 0, shobu: form.ruleset === 'shobu', kata: form.kata });
  const ficheWeight = ctx.saved?.weightClassId ? importValueText('weightClassId', ctx.saved.weightClassId, ctx) : null;

  return (
    <Stack>
        {pending > 0 && (
          <Alert color="orange" p="xs" data-testid="ffk-pending-count">
            <Text size="sm" fw={600}>{pending} choix à faire : les champs encadrés en orange. Cliquez sur FFK ou Fiche club, ou saisissez une autre valeur.</Text>
          </Alert>
        )}
        <Part disabled={frozen}>
        <SimpleGrid cols={{ base: 1, xs: 2 }}>
          {zoneBox('lastName', <>
            <TextInput ref={lastNameRef} data-autofocus={autoFocus || undefined} data-testid="line-last-name" label={labelled('Nom', 'name', 'lastName')} required value={form.lastName} onChange={(e) => set({ lastName: e.currentTarget.value })} />
            {choice('lastName')}
          </>)}
          {zoneBox('firstName', <>
            <TextInput data-testid="line-first-name" label={labelled('Prénom', 'name', 'firstName')} required value={form.firstName} onChange={(e) => set({ firstName: e.currentTarget.value })} />
            {choice('firstName')}
          </>)}
        </SimpleGrid>
        {hint('name')}
        {zoneBox('licence', <>
          <TextInput data-testid="line-licence" label={labelled('N° de licence (facultatif)', null, 'licence')} description={showLicenceHint ? 'Laissée vide, la licence déjà enregistrée est gardée.' : undefined} value={form.licence ?? ''} onChange={(e) => set({ licence: e.currentTarget.value || null })} />
          {choice('licence')}
        </>)}
        </Part>
        <Part disabled={locked}>
        {zoneBox('sex', <>
          <Input.Wrapper label={labelled('Sexe', 'sex', 'sex')} required labelElement="div" role="group" aria-label="Sexe">
            <OneOf value={form.sex} options={[['F', 'Féminin'], ['M', 'Masculin']]} onChange={(sex) => set({ sex })} />
          </Input.Wrapper>
          {choice('sex')}
        </>)}
        </Part>
        <SimpleGrid cols={{ base: 1, xs: 2 }}>
          {zoneBox('ageBandCode', <Stack gap={4}>
          <Select data-testid="line-age" label={labelled('Catégorie d’âge', 'ageBandCode', 'ageBandCode')} required data={ageBandChoices(form, ctx)} value={form.ageBandCode} disabled={locked}
            onChange={(ageBandCode) => set({ ageBandCode })} />
          {hint('ageBandCode')}
          {choice('ageBandCode')}
          </Stack>)}
          {zoneBox('weightClassId', <Stack gap={4}>
          {/* Obligatoire pour un combat (le kata n'a pas de catégorie de poids). */}
          <Select data-testid="line-weight-class" label={labelled('Catégorie de poids', 'weightClassId', 'weightClassId')} required={hasCombat} disabled={!classes.length || combatFrozen}
            placeholder={classes.length ? undefined : 'Sexe et âge d’abord'}
            data={classes.map((w) => ({ value: w.id, label: `${w.label} kg` }))} value={form.weightClassId} onChange={(weightClassId) => set({ weightClassId })} />
          {weightIssue && (
            <Text size="sm" c="red" data-testid="line-weight-issue">{weightIssue}{ficheWeight ? ` La fiche club dit ${ficheWeight}.` : ''}</Text>
          )}
          {hint('weightClassId')}
          {choice('weightClassId')}
          </Stack>)}
          {zoneBox('weightKg', <Stack gap={4}>
          <TextInput data-testid="line-weight" label={labelled('Poids actuel (facultatif)', null, 'weightKg')} rightSection={<Text size="xs">kg</Text>} inputMode="decimal" value={weight} disabled={combatFrozen}
            onChange={(e) => {
              const raw = e.currentTarget.value;
              setWeightText(raw);
              set({ weightKg: parseKg(raw) });
            }} />
          {choice('weightKg')}
          </Stack>)}
        </SimpleGrid>
        {warning && <Text size="sm" c="var(--sk-warn-text)" data-testid="line-weight-warning">{warning}</Text>}
        {/* Au moins une discipline : un combat, le kata, ou les deux (le poids et le règlement ne sont demandés que pour un combat). */}
        {zoneBox('disciplines', <>
        <Input.Wrapper label={labelled('Disciplines', 'discipline', 'disciplines')} required labelElement="div" description={kata.shown ? 'Un combat, le kata, ou les deux.' : undefined}>
          <Stack gap="sm" mt={4}>
            <div role="group" aria-label="Discipline de combat">
              <Group gap={4} wrap="wrap">
                {combats.map(([d, label]) => (
                  <Chip key={d} size="xs" checked={form.combats.includes(d)} disabled={frozen || started.has(d)} onChange={() => set({ combats: toggleCombat(form, d, ctx) })}>{label}</Chip>
                ))}
              </Group>
            </div>
            {kata.shown && (
              <Checkbox data-testid="line-kata" label={kata.label} checked={form.kata} disabled={frozen || started.has('kata')} onChange={(e) => set({ kata: e.currentTarget.checked })} />
            )}
          </Stack>
        </Input.Wrapper>
        {choice('disciplines')}
        </>)}
        {step?.switchHint && !(form.combats as DisciplineId[]).includes(step.switchHint.discipline) && (
          <Text size="xs" c="dimmed" data-testid="ffk-hint-switch">{step.switchHint.text}</Text>
        )}
        {hint('discipline')}
        {nothingOpen && <Text size="sm" c="var(--sk-warn-text)" data-testid="line-nothing-open">Aucune catégorie ouverte pour cette tranche d’âge à cette compétition.</Text>}
        {mode === 'organiser' && oneCombatPerDay && form.combats.length > 1 && (
          <Text size="sm" c="var(--sk-warn-text)" data-testid="line-multiple-off">Plusieurs combats : le réglage de la compétition n’en prévoit qu’un par jour. L’inscription est enregistrée quand même.</Text>
        )}
        <Part disabled={combatFrozen}>
        {hasCombat && zoneBox('ruleset', (
          <Input.Wrapper label={labelled('Règlement', 'ruleset', 'ruleset')} required labelElement="div" role="group" aria-label="Règlement">
            {rulesets.length ? <OneOf value={form.ruleset} options={rulesets} onChange={(ruleset) => set({ ruleset })} />
              : <Text size="sm" c="var(--sk-warn-text)" data-testid="line-no-ruleset">Aucun règlement commun à ces disciplines : décochez-en une.</Text>}
            {choice('ruleset')}
          </Input.Wrapper>
        ))}
        </Part>
        {clubs && (
          <Part disabled={frozen}>
          {zoneBox('clubId', <>
            <Select data-testid="line-club" label={labelled('Club', null, 'clubId')} required searchable data={clubs} value={value.clubId}
              nothingFoundMessage="Aucun club" onChange={(clubId) => onChange({ ...value, clubId })} />
            {choice('clubId')}
          </>)}
          </Part>
        )}
        <Part disabled={frozen}>
        {form.kata && zoneBox('grade', <>
          <TextInput data-testid="line-grade" label={labelled('Grade (pour le kata)', null, 'grade')} value={form.grade ?? ''} onChange={(e) => set({ grade: e.currentTarget.value || null })} />
          {choice('grade')}
        </>)}
        <Checkbox data-testid="line-name-hidden" label="Masquer le nom sur la page publique" description="Le public voit « Combattant masqué » ; le club reste affiché."
          checked={value.publicNameHidden} onChange={(e) => onChange({ ...value, publicNameHidden: e.currentTarget.checked })} />
        </Part>
        <Part disabled={combatFrozen}>
        {hasCombat && otherChoices.length > 0 && (
          <Paper withBorder p="md" radius="md" data-testid="line-reclass" style={{ background: 'var(--sk-bg)' }}>
            <Stack gap="sm">
              <div>
                <Text fw={600} size="sm">Reclassement : si {form.firstName.trim() || 'ce combattant'} se retrouve sans adversaire</Text>
                <Text size="sm" c="dimmed" mt={2}>Le jour de la compétition, un combattant peut se retrouver seul dans sa catégorie. L’organisation cherche alors à lui trouver un adversaire. Peut-on lui proposer une autre discipline ?</Text>
              </div>
              {zoneBox('prefs', <>
              <SimpleGrid cols={{ base: 1, xs: shownRanks.length > 1 ? 2 : 1 }}>
                {shownRanks.map((rank) => (
                  <NativeSelect key={rank} label={rank === 1 ? '1er choix' : `${rank}e choix`} value={chosen[rank - 1] ?? ''}
                    data={[
                      { value: '', label: rank === 1 ? `Non, rester en ${ownLabel}` : `Pas de ${rank}e choix` },
                      // Les rangs précédents ne sont plus proposés ; le 1er choix peut reprendre une discipline choisie plus loin.
                      ...otherChoices.filter(([d]) => !chosen.slice(0, rank - 1).includes(d)).map(([value, label]) => ({ value, label })),
                    ]}
                    onChange={(e) => set({ prefs: choosePref(form.prefs, rank, (e.currentTarget.value || null) as PrefDiscipline | null) })} />
                ))}
              </SimpleGrid>
              {choice('prefs')}
              </>, true)}
              {form.ruleset === 'shobu' && zoneBox('shobuKeep', <>
              {chosen.length > 0 ? (
                <Radio.Group label={labelled('Que lui proposer d’abord ?', null, 'shobuKeep')} value={form.shobuKeep} onChange={(v) => set({ shobuKeep: v as 'ruleset' | 'discipline' })}>
                  <Stack gap={6} mt={6}>
                    <Radio value="ruleset" label="Changer de discipline, rester en shobu" />
                    <Radio value="discipline" label={`Rester en ${ownLabel}, passer en jiyu`} />
                  </Stack>
                </Radio.Group>
              ) : <Text size="xs" c="dimmed">Sans autre discipline, on pourra seulement lui proposer de passer en jiyu.</Text>}
              {choice('shobuKeep')}
              </>)}
            </Stack>
          </Paper>
        )}
        </Part>
        {/* Différences dont le champ n'est pas affiché en ce moment : chaque conflit reste visible. */}
        {elsewhere.length > 0 && (
          <Paper withBorder p="md" radius="md" data-testid="import-hidden-conflicts" style={{ background: 'var(--sk-bg)' }}>
            <Stack gap="sm">
              <Text fw={600} size="sm">Autres différences avec la fiche</Text>
              {elsewhere.map((field) => (
                <Stack key={field} gap={2}>
                  {zoneBox(field, <>
                  <Text size="sm">{FIELD_LABELS[field]}{tag(field)}</Text>
                  {choice(field)}
                  </>)}
                </Stack>
              ))}
            </Stack>
          </Paper>
        )}
    </Stack>
  );
}

/** Morceau du formulaire qu'une ligne verrouillée désactive (un `fieldset` désactivé ne se réactive pas plus bas : d'où plusieurs morceaux). */
function Part({ disabled, children }: { disabled: boolean; children: ReactNode }) {
  // Vide (pas de reclassement à proposer…) : rien, pour ne pas ajouter d'espace.
  if (Children.toArray(children).length === 0) return null;
  return (
    // Estompé : les pastilles (Chip) ne montrent pas d'elles-mêmes qu'un `fieldset` désactivé les bloque.
    <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, opacity: disabled ? 0.55 : 1 }}>
      <Stack>{children}</Stack>
    </fieldset>
  );
}
