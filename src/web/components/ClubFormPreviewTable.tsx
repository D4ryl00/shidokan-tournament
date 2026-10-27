import { Alert, Badge, List, Stack, Table } from '@mantine/core';
import type { ClubFormPreview } from '../api.js';
import type { CategoryGrid } from '../../domain/types.js';
import { ageBandLabel, disciplineLabel, prefsLabel, rulesetShort, weightLabel } from '../labels.js';
import { plural } from '../../domain/plural.js';
import { joinEmails } from '../../domain/emails.js';
import { CLOSED_WARNING_START } from '../../domain/club-form.js';

/** Aperçu d'une fiche club (fichier importé ou fiche papier saisie) : une ligne par inscription, erreurs, remarques et retraits. */
export function ClubFormPreviewTable({ parse, grid }: { parse: ClubFormPreview; grid: CategoryGrid | undefined }) {
  const closedRows = parse.rows.filter((r) => r.warnings.some((w) => w.startsWith(CLOSED_WARNING_START))).length;
  return (
    <Stack>
      <Alert title={`Club : ${parse.header.club}`} color="blue">
        Coach : {parse.header.coachName ?? '—'} · {parse.header.coachPhone ?? '—'} · {parse.header.coachEmails.length ? joinEmails(parse.header.coachEmails) : '—'} · Pré-accord :{' '}
        {parse.header.preApproval ? 'oui' : 'non'}
      </Alert>
      {closedRows > 0 && (
        <Alert color="orange" data-testid="club-form-closed-summary">
          {plural(closedRows, 'ligne', 'lignes')} dans une catégorie non ouverte : {closedRows > 1 ? 'elles iront' : 'elle ira'} en Réaffectation.
        </Alert>
      )}
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Ligne</Table.Th><Table.Th>Combattant</Table.Th><Table.Th>Âge</Table.Th><Table.Th>Discipline</Table.Th>
            <Table.Th>Règlement</Table.Th><Table.Th>Poids</Table.Th><Table.Th>Préférences</Table.Th><Table.Th>Remarques</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {/* Une ligne de fiche (kata + combat) peut donner deux inscriptions : même numéro de ligne. */}
          {parse.rows.map((r, i) => (
            <Table.Tr key={`${r.line}-${i}`} data-testid="club-form-preview-row"
              style={r.input ? undefined : { backgroundColor: 'var(--mantine-color-red-light)' }}>
              <Table.Td>{r.line}</Table.Td>
              <Table.Td>{r.input ? `${r.input.lastName} ${r.input.firstName}` : <><Badge color="red" mr={4}>Erreur</Badge>{r.label}</>}</Table.Td>
              <Table.Td>{r.input ? ageBandLabel(grid, r.input.ageBandCode) : ''}</Table.Td>
              <Table.Td>{r.input ? disciplineLabel(r.input.discipline) : ''}</Table.Td>
              <Table.Td>{r.input ? rulesetShort(r.input.ruleset) : ''}</Table.Td>
              <Table.Td>{r.input ? weightLabel(grid, r.input.weightClassId) : ''}</Table.Td>
              <Table.Td>{r.input ? prefsLabel(r.input.otherDisciplines ?? []) : ''}</Table.Td>
              <Table.Td>
                {(r.errors.length > 0 || r.warnings.length > 0) && (
                  <List size="xs">
                    {r.errors.map((e) => <List.Item key={e} c="red" data-testid="club-form-row-error">{e}</List.Item>)}
                    {r.warnings.map((w) => <List.Item key={w} c="orange">{w}</List.Item>)}
                  </List>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {parse.removals.length > 0 && (
        <Alert color="orange" title={`Ce réimport retirera ${plural(parse.removals.length, 'inscription')} de la fiche précédente`} data-testid="club-form-removals">
          {parse.removals.map((r) => r.label).join(' · ')}
        </Alert>
      )}
    </Stack>
  );
}
