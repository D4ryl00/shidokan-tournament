import { Accordion, Alert, Anchor, Button, Center, Checkbox, Group, Loader, Select, Stack, Table, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { CONTACTS_NOT_GRANTED, DIRECTORY_CHANGED, rejectedValues, type ContactChoice, type GoogleContact, type SyncApply, type SyncPreview } from '../../domain/google-contacts.js';
import { plural } from '../../domain/plural.js';
import { ApiError, useApplyGoogleContacts, useGoogleContactsPreview } from '../api.js';
import { useDocumentTitle } from '../documentTitle.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { contactName, diffText, FIELD_LABEL, GoogleContactCard, rejectedText } from '../components/GoogleContactCard.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { SectionCard } from '../components/ui/SectionCard.js';
import { TableCard } from '../components/ui/TableCard.js';
import { applyButtonLabel, buildApply, diffKey, initialChoices, type ContactPlan } from '../googleSync.js';

const ALL = '*';
const settingsLink = <Anchor component={Link} to="/parametres#mails">Réglages de l’application</Anchor>;

/** Synchroniser les coachs de l'annuaire avec Google Contacts : tout sur une page, rien ne change avant « Appliquer ». */
export function DirectorySyncPage() {
  useDocumentTitle('Synchroniser avec Google');
  // undefined : le dernier libellé choisi (retenu par le serveur).
  const [label, setLabel] = useState<string | null | undefined>(undefined);
  const preview = useGoogleContactsPreview(label);
  const apply = useApplyGoogleContacts();
  const view = preview.data;
  // Revenir sur la page (ou changer de libellé) : l'aperçu gardé en mémoire n'est pas montré pendant que Google est relu,
  // sinon les choix faits entre-temps seraient effacés à l'arrivée du nouveau.
  const reading = preview.isFetching && !preview.isFetchedAfterMount;

  const send = (input: SyncApply) =>
    apply.mutate(input, {
      onSuccess: () => notifications.show({ color: 'green', message: 'Annuaire mis à jour.' }),
      // L'annuaire a changé entre-temps : l'aperçu est relu, le message reste affiché.
      onError: (e) => { if (e instanceof ApiError && e.status === 409 && e.message === DIRECTORY_CHANGED) void preview.refetch(); },
    });

  return (
    <Stack gap="lg">
      <PageHeader title="Synchroniser les coachs avec Google" help="synchro-google"
        actions={<Button variant="default" component={Link} to="/annuaire">Retour à l’annuaire</Button>} />
      {preview.isLoading && <Center py="xl"><Loader /></Center>}
      {preview.error && (
        <Stack gap="xs">
          <ApiErrorAlert error={preview.error} />
          <Text size="sm">{settingsLink}</Text>
        </Stack>
      )}
      {view?.state === 'no-scope' && (
        <Alert color="orange" data-testid="contacts-not-granted">
          <Stack gap="xs">
            <Text size="sm">{CONTACTS_NOT_GRANTED}</Text>
            <Text size="sm">{settingsLink}</Text>
          </Stack>
        </Alert>
      )}
      {view?.state === 'ok' && (
        <>
          <Group gap="md" align="end" wrap="wrap">
            <Select label="Libellé" data-testid="google-label" allowDeselect={false} w={260} maw="100%"
              data={[{ value: ALL, label: 'Tous les contacts' }, ...view.labels.map((l) => ({ value: l.resourceName, label: l.name }))]}
              value={(label === undefined ? view.label : label) ?? ALL}
              onChange={(v) => { apply.reset(); setLabel(v === ALL || v === null ? null : v); }} />
            <Text size="sm" c="dimmed" pb={8}>{view.account} · {plural(view.total, 'contact')}</Text>
            {preview.isFetching && !reading && <Loader size="sm" mb={8} />}
          </Group>
          {reading ? <Center py="xl" data-testid="google-sync-loading"><Loader /></Center> : (
            // Un nouvel aperçu (libellé, application, annuaire changé) repart des choix par défaut.
            <SyncForm key={preview.dataUpdatedAt} preview={view.preview} busy={preview.isFetching} pending={apply.isPending} onApply={send}
              error={<ApiErrorAlert error={apply.error} />} />
          )}
        </>
      )}
    </Stack>
  );
}

function SyncForm({ preview: p, busy, pending, onApply, error }: { preview: SyncPreview; busy: boolean; pending: boolean; onApply: (input: SyncApply) => void; error: ReactNode }) {
  const [choices, setChoices] = useState(() => initialChoices(p));
  const plan = buildApply(p, choices);
  const setPlan = (id: string) => (next: ContactPlan) => setChoices((c) => ({ ...c, plans: { ...c.plans, [id]: next } }));
  const toggleDiff = (key: string, take: boolean) =>
    setChoices((c) => ({ ...c, keptDiffs: take ? c.keptDiffs.filter((k) => k !== key) : [...c.keptDiffs, key] }));
  const names = new Map([...p.newContacts, ...p.pending, ...p.linked].map(({ contact }) => [contact.resourceName, contactName(contact)]));
  const card = (contact: GoogleContact, extra: { choice?: ContactChoice; linkedTo?: string[] }) => {
    const current = choices.plans[contact.resourceName];
    return current && (
      <GoogleContactCard key={contact.resourceName} contact={contact} choice={extra.choice} linkedTo={extra.linkedTo} plan={current}
        onChange={setPlan(contact.resourceName)} clubs={p.clubs} names={names} />
    );
  };
  const rows = p.diffs.flatMap((d) => d.fields.map((f) => ({ d, f, key: diffKey(d.clubId, f.field) })));
  const clubName = new Map(p.clubs.map((c) => [c.id, c.name]));
  // Valeurs Google des contacts liés que l'annuaire refuserait : jamais reprises, signalées sous les différences.
  const rejected = p.linked.flatMap((l) => rejectedValues(l.contact).map((r) => ({
    key: `${l.contact.resourceName}:${r.field}:${r.value}`, text: `${l.clubIds.map((id) => clubName.get(id) ?? '—').join(', ')} · ${rejectedText(r)}`,
  })));
  const unnamed = Object.entries(choices.plans).filter(([, pl]) => pl.mode === 'create' && !pl.name.trim()).map(([id]) => names.get(id) ?? 'Contact sans nom');

  return (
    <Stack gap="lg">
      <SectionCard title={`Différences avec l’annuaire (${rows.length})`}
        description="Google l’emporte, et ses adresses e-mail s’ajoutent à celles de l’annuaire : décochez une ligne pour garder l’annuaire tel quel, cette fois seulement.">
        {rejected.map((r) => (
          <Text key={r.key} size="sm" c="var(--sk-warn-text)" mb="xs" data-testid="google-rejected-diff" style={{ overflowWrap: 'anywhere' }}>{r.text}</Text>
        ))}
        {rows.length === 0 ? <Text size="sm" c="dimmed">Aucune différence : les clubs liés sont à jour.</Text> : (
          <TableCard>
            <Table>
              <Table.Thead>
                <Table.Tr><Table.Th w={40} /><Table.Th>Club</Table.Th><Table.Th>Champ</Table.Th><Table.Th>Annuaire</Table.Th><Table.Th>Google</Table.Th></Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map(({ d, f, key }) => {
                  const keep = choices.keptDiffs.includes(key);
                  const t = diffText(f);
                  // Plusieurs adresses : elles passent à la ligne au lieu d'élargir le tableau.
                  const wrap = f.field === 'coachEmails' ? { overflowWrap: 'anywhere' as const } : { whiteSpace: 'nowrap' as const };
                  return (
                    <Table.Tr key={key} data-testid="google-diff" bg={keep ? 'var(--sk-row)' : undefined}>
                      <Table.Td>
                        <Checkbox checked={!keep} onChange={(e) => toggleDiff(key, e.currentTarget.checked)} aria-label={`Prendre Google : ${d.clubName}, ${FIELD_LABEL[f.field]}`} />
                      </Table.Td>
                      <Table.Td fw={500}>{d.clubName}</Table.Td>
                      <Table.Td>{FIELD_LABEL[f.field]}</Table.Td>
                      <Table.Td c={keep ? undefined : 'dimmed'} style={wrap}>{keep ? <><b>{t.directory ?? '—'}</b> (gardé)</> : t.directory ?? '—'}</Table.Td>
                      <Table.Td c={keep ? 'dimmed' : undefined} style={wrap}>{keep ? <s>{t.google}</s> : t.google}</Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </TableCard>
        )}
      </SectionCard>

      <SectionCard title={`Nouveaux contacts (${p.newContacts.length})`}
        description="Contacts liés à aucun club : liez-les à un club de l’annuaire, créez un club, ou laissez-les pour plus tard.">
        {p.newContacts.length === 0 ? <Text size="sm" c="dimmed">Aucun nouveau contact.</Text> : (
          <Stack gap="sm">{p.newContacts.map((choice) => card(choice.contact, { choice }))}</Stack>
        )}
      </SectionCard>

      {(p.pending.length > 0 || p.linked.length > 0) && (
        <Accordion variant="contained" multiple>
          {p.pending.length > 0 && (
            <Accordion.Item value="pending">
              <Accordion.Control>En attente d’un rattachement ({p.pending.length})</Accordion.Control>
              <Accordion.Panel><Stack gap="sm">{p.pending.map((choice) => card(choice.contact, { choice }))}</Stack></Accordion.Panel>
            </Accordion.Item>
          )}
          {p.linked.length > 0 && (
            <Accordion.Item value="linked">
              <Accordion.Control>Contacts déjà liés ({p.linked.length})</Accordion.Control>
              <Accordion.Panel><Stack gap="sm">{p.linked.map((l) => card(l.contact, { linkedTo: l.clubIds }))}</Stack></Accordion.Panel>
            </Accordion.Item>
          )}
        </Accordion>
      )}

      {error}
      <Group justify="flex-end" align="center" wrap="wrap">
        {unnamed.length > 0 && (
          <Text size="sm" c="var(--sk-warn-text)" data-testid="google-apply-blocked">
            {unnamed.length === 1 ? `Donnez un nom au nouveau club de ${unnamed[0]}.` : `Donnez un nom aux nouveaux clubs de ${unnamed.join(', ')}.`}
          </Text>
        )}
        <Button data-testid="google-apply" disabled={plan.nothing || plan.missingName || busy} loading={pending} onClick={() => onApply(plan.apply)}
          style={{ maxWidth: '100%' }} styles={{ label: { whiteSpace: 'normal', textAlign: 'center' } }} h="auto" mih={36} py={6}>
          {applyButtonLabel(plan)}
        </Button>
      </Group>
    </Stack>
  );
}
