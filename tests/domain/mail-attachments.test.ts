import { expect, test } from 'vitest';
import {
  attachmentContentType,
  checkNewAttachment,
  cleanAttachmentName,
  clubFormFileNames,
  formatBytes,
  MAIL_ATTACHMENT_LIMITS,
} from '../../src/domain/mail-attachments.js';

const MB = 1024 * 1024;

test('type annoncé selon l’extension, casse ignorée ; extension non acceptée ou absente : null', () => {
  expect(attachmentContentType('Affiche.PDF')).toBe('application/pdf');
  expect(attachmentContentType('photo.jpeg')).toBe('image/jpeg');
  expect(attachmentContentType('tableau.xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  expect(attachmentContentType('a.exe')).toBeNull();
  expect(attachmentContentType('sans')).toBeNull();
});

test('nom nettoyé : sans chemin, sans caractères de contrôle, sans espaces autour, 150 caractères au plus avec l’extension', () => {
  expect(cleanAttachmentName('C:\\Users\\x\\Règlement.pdf')).toBe('Règlement.pdf');
  expect(cleanAttachmentName('/tmp/dossier/affiche.png')).toBe('affiche.png');
  expect(cleanAttachmentName('  a\u0007b.pdf ')).toBe('ab.pdf');
  const long = cleanAttachmentName(`${'x'.repeat(196)}.pdf`);
  expect(long).toHaveLength(MAIL_ATTACHMENT_LIMITS.nameLength);
  expect(long.endsWith('.pdf')).toBe(true);
});

test('refus dans l’ordre : vide, type, taille, nombre, total, nom pris', () => {
  const ok = { fileName: 'affiche.png', size: 1000 };
  expect(checkNewAttachment({ fileName: 'a.pdf', size: 0 }, [], [])).toBe('Fichier vide.');
  expect(checkNewAttachment({ fileName: 'x.EXE', size: 10 }, [], [])).toBe(
    'Type de fichier non accepté : .exe (acceptés : PDF, images, documents, tableurs, présentations, texte)',
  );
  expect(checkNewAttachment({ fileName: 'sans', size: 10 }, [], [])).toBe(
    'Type de fichier non accepté : (aucune) (acceptés : PDF, images, documents, tableurs, présentations, texte)',
  );
  expect(checkNewAttachment({ fileName: 'a.pdf', size: 10 * MB + 1 }, [], [])).toBe('Fichier trop gros : 10 Mo au plus.');
  const ten = Array.from({ length: 10 }, (_, i) => ({ fileName: `f${i}.pdf`, size: 10 }));
  expect(checkNewAttachment(ok, ten, [])).toBe('Au plus 10 pièces jointes.');
  expect(checkNewAttachment({ fileName: 'b.pdf', size: 2 * MB }, [{ fileName: 'a.pdf', size: 14 * MB }], [])).toBe('Pièces jointes trop lourdes : 15 Mo au plus en tout.');
  expect(checkNewAttachment({ fileName: 'AFFICHE.pdf', size: 10 }, [{ fileName: 'affiche.pdf', size: 10 }], [])).toBe('Une pièce jointe porte déjà ce nom.');
  expect(checkNewAttachment({ fileName: 'Fiche-Club-2026-11-22.PDF', size: 10 }, [], ['fiche-club-2026-11-22.pdf'])).toBe('Une pièce jointe porte déjà ce nom.');
  expect(checkNewAttachment(ok, [{ fileName: 'a.pdf', size: 10 * MB }], ['fiche-club-2026-11-22.pdf'])).toBeNull();
  expect(checkNewAttachment({ fileName: 'b.pdf', size: 5 * MB }, [{ fileName: 'a.pdf', size: 10 * MB }], [])).toBeNull();
});

test('noms des fiches club', () => {
  expect(clubFormFileNames('2026-11-22')).toEqual({ pdf: 'fiche-club-2026-11-22.pdf', ods: 'fiche-club-2026-11-22.ods' });
});

test('tailles lisibles', () => {
  expect(formatBytes(900)).toBe('900 o');
  expect(formatBytes(12 * 1024)).toBe('12 Ko');
  expect(formatBytes(3.4 * MB)).toBe('3,4 Mo');
});
