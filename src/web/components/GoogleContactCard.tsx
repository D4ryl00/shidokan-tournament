import type { ReactNode } from 'react';
import { Anchor, Button, Checkbox, CloseButton, Group, Paper, Radio, Select, Stack, Text, TextInput } from '@mantine/core';
import { normalizeName } from '../../domain/names.js';
import { joinEmails } from '../../domain/emails.js';
import { numberConflict, rejectedValues, type CoachField, type ContactChoice, type FieldDiff, type GoogleContact, type NumberHolders, type SyncClub } from '../../domain/google-contacts.js';
import { DIRECTORY_LIMITS } from '../../domain/registration.js';
import { diffKey, linkFields, type ContactMode, type ContactPlan } from '../googleSync.js';

export const FIELD_LABEL: Record<CoachField, string> = { coachName: 'Coach', coachPhone: 'Téléphone', coachEmails: 'E-mails', affiliationNumber: 'N° d’affiliation' };
const REASON = { number: 'même n° d’affiliation', email: 'même mail', phone: 'même téléphone' } as const;

/** Nom d'un contact pour l'écran : son nom, sinon ce qu'il a. */
export const contactName = (c: GoogleContact): string => c.name ?? c.organization ?? c.emails[0] ?? c.phone ?? 'Contact sans nom';

/**
 * Une différence à l'écran : valeur de l'annuaire (null si vide) et valeur Google ; pour les e-mails, ce qui change (`EmailChanges`).
 * `kept` : ligne décochée, rien ne sera retiré.
 */
export function diffText(f: FieldDiff, kept = false): { directory: string | null; google: ReactNode } {
  if (f.field !== 'coachEmails') return { directory: f.directory, google: f.google };
  return { directory: f.directory.length ? joinEmails(f.directory) : null, google: <EmailChanges f={f} kept={kept} /> };
}

/** « + a@x.fr, b@y.fr » pour les adresses ajoutées, « − c@z.fr » pour les adresses retirées, en rouge si elles le seront. */
function EmailChanges({ f, kept }: { f: Extract<FieldDiff, { field: 'coachEmails' }>; kept: boolean }) {
  return (
    <>
      {f.add.length > 0 && <span data-testid="email-added">+ {joinEmails(f.add)}</span>}
      {f.add.length > 0 && f.remove.length > 0 && ' '}
      {f.remove.length > 0 && <Text span inherit c={kept ? undefined : 'red'} data-testid="email-removed">− {joinEmails(f.remove)}</Text>}
    </>
  );
}

/** « E-mail — valeur Google non reprise : a@x.fr, b@y.fr » : une valeur que l'annuaire refuserait, jamais reprise. */
export const rejectedText = (r: { field: CoachField; value: string }): string => `${FIELD_LABEL[r.field]} — valeur Google non reprise : ${r.value}`;

/** Numéro Google déjà porté par une autre fiche (`holder`) : jamais repris. */
export const conflictText = (contact: GoogleContact, holder: string): string =>
  `${rejectedText({ field: 'affiliationNumber', value: contact.affiliationNumber ?? '' })} (déjà celui de « ${holder} »)`;
const warn = { c: 'var(--sk-warn-text)', style: { overflowWrap: 'anywhere' as const } };

/**
 * Un contact Google et ce qu'on en fait : le lier à un ou plusieurs clubs de l'annuaire, créer un club, ou « Plus tard ».
 * Un contact déjà lié (`linkedTo`) ne peut qu'être lié aussi à un autre club.
 */
export function GoogleContactCard({ contact, choice, linkedTo, plan, onChange, clubs, numbers, names }: {
  contact: GoogleContact;
  choice?: ContactChoice;
  linkedTo?: string[];
  plan: ContactPlan;
  onChange: (plan: ContactPlan) => void;
  clubs: SyncClub[];
  numbers: NumberHolders;
  /** Nom des contacts connus, pour « lié à … ». */
  names: Map<string, string>;
}) {
  const byId = new Map(clubs.map((c) => [c.id, c]));
  const set = (patch: Partial<ContactPlan>) => onChange({ ...plan, ...patch });
  const choose = (clubId: string) => set({ mode: 'link', clubs: [clubId, ...plan.clubs.slice(1)] });
  const exact = choice?.exact ? byId.get(choice.exact.clubId) : undefined;
  const maybe = (choice?.maybe ?? []).map((id) => byId.get(id)).filter((c): c is SyncClub => !!c);
  const linking = plan.mode === 'link' || plan.mode === null;
  const sameName = plan.mode === 'create' && plan.name.trim() ? clubs.find((c) => normalizeName(c.name) === normalizeName(plan.name)) : undefined;
  const details = [...contact.emails, contact.phone, contact.affiliationNumber && `N° ${contact.affiliationNumber}`]
    .filter((x): x is string => !!x && x !== contactName(contact));
  const createConflict = plan.mode === 'create' ? numberConflict(contact, null, numbers) : null;

  const linkedName = (c: SyncClub): string | null =>
    c.googleContactId && c.googleContactId !== contact.resourceName ? names.get(c.googleContactId) ?? 'un autre contact' : null;
  const rejected = rejectedValues(contact);

  const options = (index: number) =>
    clubs
      .filter((c) => !(linkedTo ?? []).includes(c.id) && !plan.clubs.some((id, i) => i !== index && id === c.id))
      .map((c) => {
        const other = linkedName(c);
        return { value: c.id, label: other ? `${c.name} — lié à ${other}` : c.name };
      });

  return (
    <Paper withBorder p="sm" data-testid="contact-card">
      <Stack gap="xs">
        <div>
          <Text fw={600} span>{contactName(contact)}</Text>
          {details.length > 0 && <Text span c="dimmed" size="sm"> · {details.join(' · ')}</Text>}
          {contact.organization && contact.name && <Text size="xs" c="dimmed">Entreprise : {contact.organization}</Text>}
          {rejected.map((r) => (
            <Text key={`${r.field}:${r.value}`} size="xs" {...warn}>{rejectedText(r)}</Text>
          ))}
        </div>
        {linkedTo && <Text size="sm">Lié à : {linkedTo.map((id) => byId.get(id)?.name ?? '—').join(', ')}</Text>}
        {choice && (
          <Group gap="xs" wrap="wrap">
            {exact
              ? <Text size="sm" c="dimmed">Proposé : <b>{exact.name}</b> ({REASON[choice.exact!.reason]})</Text>
              : maybe.length === 0 && <Text size="sm" c="dimmed">Aucun coach correspondant</Text>}
            {maybe.filter((c) => !(plan.mode === 'link' && plan.clubs.includes(c.id))).map((c) => {
              const other = linkedName(c);
              return (
                <Button key={c.id} size="compact-sm" variant="light" onClick={() => choose(c.id)}
                  styles={{ label: { whiteSpace: 'normal' } }} h="auto" mih={22} style={{ maxWidth: '100%' }}>
                  Peut-être : {c.name} ?{other && ` (déjà lié à ${other})`}
                </Button>
              );
            })}
          </Group>
        )}
        {plan.mode !== null && (
          <Radio.Group value={plan.mode} onChange={(v) => set({ mode: v as Exclude<ContactMode, null> })} aria-label={`Choix pour ${contactName(contact)}`}>
            <Group gap="md" wrap="wrap">
              <Radio value="link" label="Lier à un club" />
              <Radio value="create" label="Nouveau club" />
              <Radio value="later" label="Plus tard" />
            </Group>
          </Radio.Group>
        )}
        {linking && plan.clubs.map((clubId, i) => {
          const club = clubId ? byId.get(clubId) : undefined;
          return (
            <Stack key={i} gap={4} pl={plan.mode === null ? 0 : 'md'}>
              <Group gap="xs" wrap="nowrap" align="center">
                <Select aria-label="Club" placeholder="Choisir un club" searchable data={options(i)} value={clubId} style={{ flex: '1 1 auto' }} maw={420}
                  onChange={(v) => set({ clubs: plan.clubs.map((x, k) => (k === i ? v : x)) })} />
                {(i > 0 || plan.mode === null) && (
                  <CloseButton aria-label="Retirer ce club" onClick={() => set({ clubs: plan.clubs.filter((_, k) => k !== i) })} />
                )}
              </Group>
              {club && <LinkFields contact={contact} club={club} numbers={numbers} plan={plan} onChange={onChange} />}
            </Stack>
          );
        })}
        {linking && (
          <Group>
            <Button size="compact-sm" variant="subtle" onClick={() => set({ clubs: [...plan.clubs, null] })}>
              + Lier aussi à un autre club
            </Button>
          </Group>
        )}
        {plan.mode === 'create' && (
          <Stack gap={4} pl="md">
            <TextInput label="Nom du club" required maw={420} maxLength={DIRECTORY_LIMITS.name} value={plan.name}
              error={plan.name.trim() ? undefined : 'Donnez un nom au club.'} onChange={(e) => set({ name: e.currentTarget.value })} />
            {sameName && (
              <Text size="sm" c="var(--sk-warn-text)">
                Un club porte déjà ce nom : <Anchor component="button" type="button" size="sm" onClick={() => choose(sameName.id)}>le lier plutôt ?</Anchor>
              </Text>
            )}
            {createConflict && <Text size="xs" {...warn}>{conflictText(contact, createConflict)}</Text>}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}

/** Sous un club choisi : une case par champ qui diffère (cochée = prendre Google) ; les champs vides du club sont remplis. */
function LinkFields({ contact, club, numbers, plan, onChange }: { contact: GoogleContact; club: SyncClub; numbers: NumberHolders; plan: ContactPlan; onChange: (plan: ContactPlan) => void }) {
  const { boxes, fills } = linkFields(contact, club, numbers);
  const conflict = numberConflict(contact, club.id, numbers);
  if (!boxes.length && !fills.length && !conflict) return null;
  return (
    <Stack gap={4} pl="xs">
      {boxes.map((f) => {
        const key = diffKey(club.id, f.field);
        const keep = plan.kept.includes(key);
        const t = diffText(f, keep);
        return (
          <Checkbox key={key} size="xs" checked={!keep} aria-label={`Prendre Google : ${club.name}, ${FIELD_LABEL[f.field]}`}
            onChange={(e) => onChange({ ...plan, kept: e.currentTarget.checked ? plan.kept.filter((k) => k !== key) : [...plan.kept, key] })}
            label={f.field === 'coachEmails'
              ? <>{FIELD_LABEL[f.field]} : {t.directory} {keep ? <s>{t.google}</s> : <b>{t.google}</b>}{keep && ' (gardé)'}</>
              : <>{FIELD_LABEL[f.field]} : {keep ? <b>{t.directory}</b> : <s>{t.directory}</s>} → {keep ? <s>{t.google}</s> : <b>{t.google}</b>}{keep && ' (gardé)'}</>} />
        );
      })}
      {fills.map((f) => <Text key={f.field} size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>{FIELD_LABEL[f.field]} rempli : {f.field === 'coachEmails' ? joinEmails(f.add) : f.google}</Text>)}
      {conflict && <Text size="xs" {...warn}>{conflictText(contact, conflict)}</Text>}
    </Stack>
  );
}
