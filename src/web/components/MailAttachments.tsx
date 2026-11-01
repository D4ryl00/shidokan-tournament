import { ActionIcon, Anchor, Button, Checkbox, FileButton, Group, Stack, Text } from '@mantine/core';
import { useRef, useState } from 'react';
import { checkNewAttachment, cleanAttachmentName, clubFormFileNames, formatBytes, replacedMissing } from '../../domain/mail-attachments.js';
import {
  ApiError,
  mailAttachmentUrl,
  useAddMailAttachment,
  useClubEntrySettings,
  useCompetition,
  useDeleteMailAttachment,
  useMailAttachments,
  useSetMailAttachmentIncluded,
  useUpdateCompetition,
} from '../api.js';
import { ApiErrorAlert } from './ApiErrorAlert.js';
import { IconTrash } from './ui/icons.js';

/** Une pièce jointe telle que l'écran la montre : `label` précise la nature des fiches club. */
export interface AttachmentLine {
  key: string;
  fileName: string;
  label: string | null;
  href: string;
  included: boolean;
  missing: boolean;
  size: number | null;
  /** Fichier ajouté (supprimable) : son id. */
  attachmentId: string | null;
}

/** Les pièces jointes du mail aux clubs dans l'ordre d'envoi : fiche à imprimer, tableur, puis fichiers ajoutés. */
export function useAttachmentLines(competitionId: string): AttachmentLine[] | null {
  const { data: competition } = useCompetition(competitionId);
  const { data: added } = useMailAttachments(competitionId);
  if (!competition || !added) return null;
  const names = clubFormFileNames(competition.date);
  const forms = competition.settings.clubFormAttachments;
  return [
    { key: 'pdf', fileName: names.pdf, label: 'fiche à imprimer (PDF)', href: `/api/competitions/${competitionId}/club-form.pdf`, included: forms.pdf, missing: false, size: null, attachmentId: null },
    { key: 'ods', fileName: names.ods, label: 'tableur (.ods)', href: `/api/competitions/${competitionId}/club-form.ods`, included: forms.ods, missing: false, size: null, attachmentId: null },
    ...added.map((a) => ({ key: a.id, fileName: a.fileName, label: null, href: mailAttachmentUrl(competitionId, a.id), included: a.included, missing: a.missing, size: a.size, attachmentId: a.id })),
  ];
}

/** Pièces cochées : celles qui partiront avec le mail (une manquante fait refuser l'envoi). */
export const sentLines = (lines: AttachmentLine[]) => lines.filter((l) => l.included);

/** Gestion des pièces jointes du mail aux clubs : fiches décochables, fichiers ajoutés cochables et supprimables. */
export function MailAttachments({ competitionId }: { competitionId: string }) {
  const lines = useAttachmentLines(competitionId);
  const { data: entry } = useClubEntrySettings(competitionId);
  const { data: competition } = useCompetition(competitionId);
  const updateCompetition = useUpdateCompetition(competitionId);
  const add = useAddMailAttachment(competitionId);
  const setIncluded = useSetMailAttachmentIncluded(competitionId);
  const remove = useDeleteMailAttachment(competitionId);
  const [refusals, setRefusals] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  // Case cliquée : sa nouvelle valeur s'affiche tout de suite, pendant l'enregistrement.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const resetRef = useRef<() => void>(null);
  if (!lines || !competition) return null;
  const readOnly = entry?.managedHere === false;

  const toggle = (line: AttachmentLine, included: boolean) => {
    setPending((p) => ({ ...p, [line.key]: included }));
    const onSettled = () => setPending(({ [line.key]: _, ...rest }) => rest);
    if (line.attachmentId) setIncluded.mutate({ attachmentId: line.attachmentId, included }, { onSettled });
    else updateCompetition.mutate({ settings: { clubFormAttachments: { [line.key]: included } } }, { onSettled });
  };

  const addFiles = async (files: File[]) => {
    resetRef.current?.();
    setRefusals([]);
    setAdding(true);
    const reserved = lines.filter((l) => !l.attachmentId).map((l) => l.fileName);
    const existing = lines.filter((l) => l.attachmentId).map((l) => ({ fileName: l.fileName, size: l.size ?? 0, missing: l.missing }));
    const refused: string[] = [];
    for (const file of files) {
      const fileName = cleanAttachmentName(file.name);
      const refusal = checkNewAttachment({ fileName, size: file.size }, existing, reserved);
      if (refusal) {
        refused.push(`${file.name} : ${refusal}`);
        continue;
      }
      try {
        await add.mutateAsync(file);
        // Un fichier manquant du même nom a été remplacé : il ne compte plus qu'une fois.
        const replaced = replacedMissing(fileName, existing);
        if (replaced) replaced.missing = false;
        else existing.push({ fileName, size: file.size, missing: false });
      } catch (err) {
        refused.push(`${file.name} : ${err instanceof ApiError ? err.message : String(err)}`);
      }
    }
    setRefusals(refused);
    setAdding(false);
  };

  return (
    <Stack gap="xs" data-testid="mail-attachments">
      <Text size="sm" fw={600}>Pièces jointes</Text>
      {lines.map((l) => (
        <Group key={l.key} gap="xs" wrap="nowrap" justify="space-between">
          <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
            <Checkbox
              aria-label={`Joindre ${l.fileName}`}
              checked={pending[l.key] ?? l.included}
              disabled={readOnly}
              onChange={(e) => toggle(l, e.currentTarget.checked)}
            />
            <Text size="sm" style={{ overflowWrap: 'anywhere' }} c={l.missing ? 'red' : undefined}>
              {l.missing ? l.fileName : <Anchor href={l.href} download={l.fileName}>{l.fileName}</Anchor>}
              {l.label ? ` — ${l.label}` : ''}
              {l.size !== null && !l.missing ? ` (${formatBytes(l.size)})` : ''}
              {l.missing ? ' — Fichier manquant' : ''}
            </Text>
          </Group>
          {l.attachmentId && (
            <ActionIcon variant="subtle" color="red" aria-label={`Supprimer ${l.fileName}`} disabled={readOnly}
              loading={remove.isPending && remove.variables === l.attachmentId} onClick={() => remove.mutate(l.attachmentId!)}>
              <IconTrash />
            </ActionIcon>
          )}
        </Group>
      ))}
      <Group gap="xs">
        <FileButton onChange={(files) => void addFiles(files)} multiple resetRef={resetRef} inputProps={{ 'data-testid': 'mail-attachment-input' } as object}>
          {(props) => <Button {...props} size="xs" variant="default" disabled={readOnly} loading={adding}>Ajouter un fichier</Button>}
        </FileButton>
        <Text size="xs" c="dimmed">PDF, images, documents, tableurs, présentations, texte : 10 fichiers, 10 Mo chacun, 15 Mo en tout.</Text>
      </Group>
      {refusals.map((r) => <Text key={r} size="sm" c="red">{r}</Text>)}
      <ApiErrorAlert error={setIncluded.error ?? remove.error ?? updateCompetition.error} />
      <Text size="sm" c="dimmed">Si le texte du message cite les pièces jointes, pensez à l’adapter.</Text>
    </Stack>
  );
}
