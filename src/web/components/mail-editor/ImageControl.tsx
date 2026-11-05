import { FileButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { RichTextEditor, useRichTextEditorContext } from '@mantine/tiptap';
import { useRef } from 'react';
import type { Editor } from '@tiptap/core';
import { MAIL_IMAGE_LIMITS } from '../../../domain/mail-images.js';
import { uploadMailImage } from '../../api.js';
import { prepareImage } from './images.js';

const countImages = (editor: Editor) => {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'image') n++;
  });
  return n;
};

const refuse = (message: string) => notifications.show({ color: 'red', message });

/** Réduit, envoie puis insère les images (bouton, collage, dépôt) : largeur moyenne, 10 images au plus par message. */
export async function insertImages(editor: Editor, files: File[], pos?: number, blocked: () => boolean = () => false): Promise<void> {
  const inCode = 'Revenez à l’éditeur pour ajouter une image.';
  for (const file of files) {
    if (blocked()) { refuse(inCode); return; }
    if (countImages(editor) >= MAIL_IMAGE_LIMITS.perMessage) {
      refuse(`Au plus ${MAIL_IMAGE_LIMITS.perMessage} images par message.`);
      return;
    }
    try {
      const { url } = await uploadMailImage(await prepareImage(file));
      if (blocked()) { refuse(inCode); return; } // le mode code s'est ouvert pendant l'envoi
      const image = { type: 'image', attrs: { src: url, width: MAIL_IMAGE_LIMITS.widths.medium } };
      const chain = editor.chain().focus();
      (pos === undefined ? chain.insertContent(image) : chain.insertContentAt(pos, image)).run();
    } catch (err) {
      refuse(err instanceof Error ? err.message : String(err));
    }
  }
}

/** Seul bouton ajouté à la barre de Mantine : insérer une image. */
export function ImageControl({ disabled, blocked }: { disabled: boolean; blocked: () => boolean }) {
  const { editor } = useRichTextEditorContext();
  const resetRef = useRef<() => void>(null);
  return (
    <FileButton accept="image/*" multiple resetRef={resetRef} onChange={(files) => { resetRef.current?.(); if (editor) void insertImages(editor as never, files, undefined, blocked); }} inputProps={{ 'data-testid': 'mail-editor-image-input' } as object}>
      {(props) => (
        <RichTextEditor.Control {...props} disabled={disabled} aria-label="Image" title="Image" data-testid="mail-editor-image">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <circle cx="9" cy="10" r="1.6" />
            <path d="M21 16l-5-5-8 9" />
          </svg>
        </RichTextEditor.Control>
      )}
    </FileButton>
  );
}
