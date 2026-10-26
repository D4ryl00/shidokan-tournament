import { Alert, Button, Divider, Group, Modal, NativeSelect, NumberInput, PasswordInput, SegmentedControl, SimpleGrid, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useEffect, useState } from 'react';
import { GOOGLE_NOT_CONFIGURED, GOOGLE_RECONNECT, type MailMode, type PublicAppSettings, type SmtpSettings } from '../../domain/app-settings.js';
import { useAppSettings, useAuthMe, useGoogleDisconnect, useGoogleStart, useSendTestMail, useUpdateAppSettings } from '../api.js';
import { useDocumentTitle } from '../documentTitle.js';
import { SyncSettingsCard } from '../components/SyncPanel.js';
import { MirrorCopies, MirrorSettingsCard } from '../components/MirrorPanels.js';
import { DayChecklist } from '../components/DayChecklist.js';
import { ZoneLinkCard } from '../components/ZoneLinkCard.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { HELP } from '../help.js';
import { PageHeader } from '../components/ui/PageHeader.js';
import { SectionCard } from '../components/ui/SectionCard.js';
import { RuleLadder } from '../components/replacement/RuleLadder.js';
import type { RulesView } from '../../domain/replacement/rules.js';

const saved = () => notifications.show({ color: 'green', message: 'Réglages enregistrés.' });

const GOOGLE_RETURN: Record<string, { color: string; message: string }> = {
  connecte: { color: 'green', message: 'Compte Google connecté.' },
  annule: { color: 'gray', message: 'Connexion à Google annulée.' },
  'envoi-refuse': { color: 'orange', message: 'L’autorisation d’envoyer des mails n’a pas été cochée chez Google : recommencez et cochez-la.' },
  expire: { color: 'orange', message: 'Le retour de Google a expiré ou n’est pas valable : recommencez.' },
  erreur: { color: 'red', message: 'Google n’a pas pu terminer la connexion : réessayez.' },
};

/** Retour de Google (`?google=…`) : un message, puis l'adresse nettoyée (on garde #mails). */
function useGoogleReturnNotice() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get('google');
    if (!result) return;
    const notice = GOOGLE_RETURN[result];
    if (notice) notifications.show(notice);
    url.searchParams.delete('google');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, []);
}

function TestMail({ disabled }: { disabled: boolean }) {
  const test = useSendTestMail();
  const [to, setTo] = useState('');
  return (
    <Stack gap="xs">
      <Group align="end" gap="sm">
        <TextInput label="Envoyer un mail d’essai à" value={to} w={260} onChange={(e) => setTo(e.currentTarget.value)} />
        <Button variant="default" disabled={!to || disabled} loading={test.isPending}
          onClick={() => test.mutate(to, { onSuccess: () => notifications.show({ color: 'green', message: `Mail d’essai envoyé à ${to}.` }) })}>
          Envoyer un mail d’essai
        </Button>
      </Group>
      <ApiErrorAlert error={test.error} />
    </Stack>
  );
}

function SmtpForm({ settings }: { settings: PublicAppSettings }) {
  const update = useUpdateAppSettings();
  const s = settings.smtp;
  const [form, setForm] = useState<Omit<SmtpSettings, 'password'>>({
    host: s?.host ?? 'smtp.gmail.com', port: s?.port ?? 465, security: s?.security ?? 'tls', user: s?.user ?? '', fromName: s?.fromName ?? 'Shidokan France', fromEmail: s?.fromEmail ?? '',
  });
  const [password, setPassword] = useState('');
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  return (
    <>
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
      <ApiErrorAlert error={update.error} />
      <Group justify="space-between" align="end" wrap="wrap">
        <TestMail disabled={!s || settings.mailMode !== 'smtp'} />
        <Button loading={update.isPending} onClick={() => update.mutate({ mailMode: 'smtp', smtp: { ...form, password: password || null } }, { onSuccess: () => { setPassword(''); saved(); } })}>Enregistrer</Button>
      </Group>
    </>
  );
}

function GoogleForm({ settings }: { settings: PublicAppSettings }) {
  const update = useUpdateAppSettings();
  const start = useGoogleStart();
  const disconnect = useGoogleDisconnect();
  const g = settings.google;
  const [fromName, setFromName] = useState(g?.fromName ?? 'Shidokan France');
  const [confirm, setConfirm] = useState(false);
  const connectButton = (label: string, variant = 'filled') => (
    <Button variant={variant} loading={start.isPending} disabled={!settings.googleAvailable} onClick={() => start.mutate()}>{label}</Button>
  );
  return (
    <>
      {!settings.googleAvailable && <Alert color="orange">{GOOGLE_NOT_CONFIGURED}</Alert>}
      <ApiErrorAlert error={start.error ?? update.error ?? disconnect.error} />
      {!g ? (
        <Stack gap="xs" align="flex-start">
          <Text size="sm" c="dimmed">Google affichera « application non validée » : cliquez sur Paramètres avancés, puis Accéder. L’application ne pourra qu’envoyer des mails, pas les lire.</Text>
          {connectButton('Se connecter avec Google')}
        </Stack>
      ) : (
        <>
          {g.status === 'reconnect' && <Alert color="red">{GOOGLE_RECONNECT}</Alert>}
          <Group justify="space-between" wrap="wrap">
            <Text data-testid="google-connected">Connecté : <b>{g.email}</b></Text>
            <Group gap="xs">
              {connectButton('Se reconnecter', g.status === 'reconnect' ? 'filled' : 'default')}
              <Button variant="subtle" color="red" onClick={() => setConfirm(true)}>Déconnecter</Button>
            </Group>
          </Group>
          <Group justify="space-between" align="end" wrap="wrap">
            <TextInput label="Nom de l’expéditeur" value={fromName} w={260} onChange={(e) => setFromName(e.currentTarget.value)} />
            <Button loading={update.isPending} onClick={() => update.mutate({ mailMode: 'google', googleFromName: fromName }, { onSuccess: saved })}>Enregistrer</Button>
          </Group>
          <TestMail disabled={settings.mailMode !== 'google' || g.status === 'reconnect'} />
        </>
      )}
      <Modal opened={confirm} onClose={() => setConfirm(false)} title="Déconnecter le compte Google ?">
        <Stack>
          <Text size="sm">Les mails ne pourront plus partir de ce compte tant qu’il n’est pas reconnecté.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirm(false)}>Annuler</Button>
            <Button color="red" loading={disconnect.isPending}
              onClick={() => disconnect.mutate(undefined, {
                onSuccess: ({ revoked }) => {
                  setConfirm(false);
                  notifications.show(revoked
                    ? { color: 'green', message: 'Compte Google déconnecté.' }
                    : { color: 'orange', message: 'Déconnecté ici, mais Google n’a pas pu être prévenu : retirez l’accès depuis votre compte Google (Sécurité → Applications tierces).' });
                },
              })}>
              Déconnecter
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

function MailCard({ settings }: { settings: PublicAppSettings }) {
  const choice = settings.googleAvailable || settings.mailMode === 'google';
  const [mode, setMode] = useState<MailMode>(settings.mailMode);
  return (
    <SectionCard id="mails" title="Envoi des mails" description="Le compte qui envoie les invitations aux clubs et les mails d’essai.">
      {choice && (
        <SegmentedControl value={mode} onChange={(v) => setMode(v as MailMode)} data={[{ value: 'google', label: 'Compte Google' }, { value: 'smtp', label: 'Autre serveur (identifiant et mot de passe)' }]} />
      )}
      {choice && mode === 'google' ? <GoogleForm settings={settings} /> : <SmtpForm settings={settings} />}
    </SectionCard>
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
    <SectionCard id="clubs" title="Message aux clubs et données personnelles"
      description="Le message des invitations, la mention de la page des clubs et la durée de conservation des données.">
      <Stack gap="xs">
        <Title order={4} fz="md">Message aux clubs</Title>
        <Text size="sm" c="dimmed">Variables : {'{club} {coach} {competition} {date} {lieu} {date_limite} {lien}'}. Chaque compétition peut avoir son propre message (onglet Fiche club).</Text>
        <TextInput label="Objet" value={form.subject} onChange={(e) => set({ subject: e.currentTarget.value })} />
        <Textarea label="Texte" autosize minRows={8} value={form.body} onChange={(e) => set({ body: e.currentTarget.value })} />
      </Stack>
      <Divider color="var(--sk-line)" />
      <Stack gap="xs">
        <Title order={4} fz="md">Données personnelles</Title>
        <Textarea label="Mention affichée sur la page des clubs" description="{contact} est remplacé par l’adresse de contact." autosize minRows={3} value={form.privacyNotice}
          onChange={(e) => set({ privacyNotice: e.currentTarget.value })} />
        <TextInput data-testid="privacy-contact" label="Adresse de contact" placeholder="par exemple rgpd@shidokanfrance.com" value={form.privacyContact} maw={420} onChange={(e) => set({ privacyContact: e.currentTarget.value })} />
      </Stack>
      <Divider color="var(--sk-line)" />
      <Stack gap="xs">
        <Title order={4} fz="md">Conservation</Title>
        <Group align="end">
          <NumberInput label="Données d’organisation effacées après (mois)" min={1} max={240} value={form.retentionMonths} onChange={(v) => set({ retentionMonths: Number(v) || 13 })} />
          <NumberInput label="Club de l’annuaire archivé sans compétition depuis (ans)" min={1} max={50} value={form.directoryInactiveYears} onChange={(v) => set({ directoryInactiveYears: Number(v) || 3 })} />
        </Group>
      </Stack>
      <ApiErrorAlert error={update.error} />
      <Group justify="flex-end"><Button loading={update.isPending} onClick={save}>Enregistrer</Button></Group>
    </SectionCard>
  );
}

function ReplacementRulesCard({ settings }: { settings: PublicAppSettings }) {
  const update = useUpdateAppSettings();
  const [view, setView] = useState<RulesView>(settings.defaultReplacementRules);
  return (
    <SectionCard id="regles" title="Règles de réaffectation par défaut" description="Copiées dans chaque nouvelle compétition. Les compétitions déjà créées ne changent pas.">
      <RuleLadder view={view} onChange={setView} busy={update.isPending} />
      <ApiErrorAlert error={update.error} />
      <Group justify="flex-end">
        <Button loading={update.isPending} onClick={() => update.mutate({ defaultReplacementRules: { ...view, on: { ...view.on, return: true } } }, { onSuccess: saved })}>Enregistrer</Button>
      </Group>
    </SectionCard>
  );
}

export function AppSettingsPage() {
  useDocumentTitle('Réglages');
  useGoogleReturnNotice();
  const { data } = useAppSettings();
  const { data: me } = useAuthMe();
  const local = me?.role === 'local';
  const sections = [
    ...(data ? [{ id: 'mails', label: 'Envoi des mails' }, { id: 'clubs', label: 'Message aux clubs' }, { id: 'regles', label: 'Règles de réaffectation' }] : []),
    ...(me ? [{ id: 'synchronisation', label: HELP.synchronisation.title }] : []),
    { id: 'jour-j', label: 'Préparer le jour J' },
    ...(local ? [{ id: 'secours', label: 'Copie de secours' }, { id: 'zones-autonomes', label: 'Portable de zone' }] : []),
  ];
  return (
    <Stack gap="lg">
      <PageHeader title={HELP.parametres.title} help="parametres" />
      <Group gap="xs" data-testid="settings-summary">
        {sections.map((x) => <Button key={x.id} component="a" href={`#${x.id}`} size="compact-sm" variant="subtle">{x.label}</Button>)}
      </Group>
      {data && (
        <>
          <MailCard settings={data} />
          <TextsCard settings={data} />
          <ReplacementRulesCard settings={data} />
        </>
      )}
      {me && (
        <SectionCard id="synchronisation" title={HELP.synchronisation.title} help="synchronisation">
          <SyncSettingsCard role={me.role} />
        </SectionCard>
      )}
      <SectionCard id="jour-j" title={HELP['jour-j'].title} help="jour-j">
        <DayChecklist />
      </SectionCard>
      {local && (
        <SectionCard id="secours" title="Copie de secours d’un autre PC">
          <MirrorSettingsCard />
          <MirrorCopies />
        </SectionCard>
      )}
      {local && (
        <SectionCard id="zones-autonomes" title={HELP['zones-autonomes'].title} help="zones-autonomes">
          <ZoneLinkCard />
        </SectionCard>
      )}
    </Stack>
  );
}
