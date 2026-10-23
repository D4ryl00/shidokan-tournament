import { Button, Card, Group, NativeSelect, NumberInput, PasswordInput, SimpleGrid, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import type { PublicAppSettings, SmtpSettings } from '../../domain/app-settings.js';
import { useAppSettings, useAuthMe, useSendTestMail, useUpdateAppSettings } from '../api.js';
import { SyncSettingsCard } from '../components/SyncPanel.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { SectionHeader } from '../components/Help.js';

const saved = () => notifications.show({ color: 'green', message: 'Réglages enregistrés.' });

function SmtpCard({ settings }: { settings: PublicAppSettings }) {
  const update = useUpdateAppSettings();
  const test = useSendTestMail();
  const s = settings.smtp;
  const [form, setForm] = useState<Omit<SmtpSettings, 'password'>>({
    host: s?.host ?? 'smtp.gmail.com', port: s?.port ?? 465, security: s?.security ?? 'tls', user: s?.user ?? '', fromName: s?.fromName ?? 'Shidokan France', fromEmail: s?.fromEmail ?? '',
  });
  const [password, setPassword] = useState('');
  const [to, setTo] = useState('');
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  return (
    <Card withBorder>
      <Stack>
        <Title order={4}>Envoi des mails</Title>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <TextInput label="Serveur SMTP" value={form.host} onChange={(e) => set({ host: e.currentTarget.value })} />
          <NumberInput label="Port" min={1} max={65535} value={form.port} onChange={(v) => set({ port: Number(v) || 465 })} />
          <NativeSelect label="Chiffrement" value={form.security} onChange={(e) => set({ security: e.currentTarget.value as SmtpSettings['security'] })}
            data={[{ value: 'tls', label: 'TLS (port 465)' }, { value: 'starttls', label: 'STARTTLS (port 587)' }, { value: 'none', label: 'Aucun' }]} />
          <TextInput label="Identifiant" value={form.user} onChange={(e) => set({ user: e.currentTarget.value })} />
          <PasswordInput label="Mot de passe" placeholder={s?.hasPassword ? 'laisser vide pour garder le mot de passe enregistré' : ''} value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
          <span />
          <TextInput label="Nom de l’expéditeur" value={form.fromName} onChange={(e) => set({ fromName: e.currentTarget.value })} />
          <TextInput label="Adresse de l’expéditeur" value={form.fromEmail} onChange={(e) => set({ fromEmail: e.currentTarget.value })} />
        </SimpleGrid>
        <Group>
          <Button loading={update.isPending} onClick={() => update.mutate({ smtp: { ...form, password: password || null } }, { onSuccess: () => { setPassword(''); saved(); } })}>Enregistrer</Button>
        </Group>
        <ApiErrorAlert error={update.error} />
        <Group align="end">
          <TextInput label="Envoyer un mail d’essai à" value={to} onChange={(e) => setTo(e.currentTarget.value)} />
          <Button variant="light" disabled={!to || !s} loading={test.isPending}
            onClick={() => test.mutate(to, { onSuccess: () => notifications.show({ color: 'green', message: `Mail d’essai envoyé à ${to}.` }) })}>
            Envoyer un mail d’essai
          </Button>
        </Group>
        <ApiErrorAlert error={test.error} />
      </Stack>
    </Card>
  );
}

function TextsCard({ settings }: { settings: PublicAppSettings }) {
  const update = useUpdateAppSettings();
  const [form, setForm] = useState({
    subject: settings.invitationMail.subject, body: settings.invitationMail.body, privacyNotice: settings.privacyNotice, privacyContact: settings.privacyContact,
    retentionMonths: settings.retentionMonths, directoryInactiveYears: settings.directoryInactiveYears,
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const save = () =>
    update.mutate(
      { invitationMail: { subject: form.subject, body: form.body }, privacyNotice: form.privacyNotice, privacyContact: form.privacyContact, retentionMonths: form.retentionMonths, directoryInactiveYears: form.directoryInactiveYears },
      { onSuccess: saved },
    );
  return (
    <Card withBorder>
      <Stack>
        <Title order={4}>Message aux clubs</Title>
        <Text size="sm" c="dimmed">Variables : {'{club} {coach} {competition} {date} {lieu} {date_limite} {lien}'}. Chaque compétition peut avoir son propre message (onglet Fiche club).</Text>
        <TextInput label="Objet" value={form.subject} onChange={(e) => set({ subject: e.currentTarget.value })} />
        <Textarea label="Texte" autosize minRows={8} value={form.body} onChange={(e) => set({ body: e.currentTarget.value })} />
        <Title order={4}>Données personnelles</Title>
        <Textarea label="Mention affichée sur la page des clubs" description="{contact} est remplacé par l’adresse de contact." autosize minRows={3} value={form.privacyNotice}
          onChange={(e) => set({ privacyNotice: e.currentTarget.value })} />
        <TextInput data-testid="privacy-contact" label="Adresse de contact" placeholder="par exemple rgpd@shidokanfrance.com" value={form.privacyContact} onChange={(e) => set({ privacyContact: e.currentTarget.value })} />
        <Title order={4}>Conservation</Title>
        <Group>
          <NumberInput label="Données d’organisation effacées après (mois)" min={1} max={240} value={form.retentionMonths} onChange={(v) => set({ retentionMonths: Number(v) || 13 })} />
          <NumberInput label="Club de l’annuaire archivé sans compétition depuis (ans)" min={1} max={50} value={form.directoryInactiveYears} onChange={(v) => set({ directoryInactiveYears: Number(v) || 3 })} />
        </Group>
        <Group><Button loading={update.isPending} onClick={save}>Enregistrer</Button></Group>
        <ApiErrorAlert error={update.error} />
      </Stack>
    </Card>
  );
}

export function AppSettingsPage() {
  const { data } = useAppSettings();
  const { data: me } = useAuthMe();
  return (
    <Stack maw={960}>
      <SectionHeader topic="parametres" order={2} />
      {data && (
        <>
          <SmtpCard settings={data} />
          <TextsCard settings={data} />
        </>
      )}
      {me && (
        <Card withBorder>
          <Stack>
            <SectionHeader topic="synchronisation" />
            <SyncSettingsCard role={me.role} />
          </Stack>
        </Card>
      )}
    </Stack>
  );
}
