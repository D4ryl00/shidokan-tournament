import { FileButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { RichTextEditor, useRichTextEditorContext } from '@mantine/tiptap';
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
export async function insertImages(editor: Editor, files: File[], pos?: number): Promise<void> {
  for (const file of files) {
    if (countImages(editor) >= MAIL_IMAGE_LIMITS.perMessage) {
      refuse(`Au plus ${MAIL_IMAGE_LIMITS.perMessage} images par message.`);
      return;
    }
    try {
      const { url } = await uploadMailImage(await prepareImage(file));
      const image = { type: 'image', attrs: { src: url, width: MAIL_IMAGE_LIMITS.widths.medium } };
      const chain = editor.chain().focus();
      (pos === undefined ? chain.insertContent(image) : chain.insertContentAt(pos, image)).run();
    } catch (err) {
      refuse(err instanceof Error ? err.message : String(err));
    }
  }
}

/** Seul bouton ajouté à la barre de Mantine : insérer une image. */
export function ImageControl() {
  const { editor } = useRichTextEditorContext();
  return (
    <FileButton accept="image/*" multiple onChange={(files) => editor && void insertImages(editor as never, files)} inputProps={{ 'data-testid': 'mail-editor-image-input' } as object}>
      {(props) => (
        <RichTextEditor.Control {...props} aria-label="Image" title="Image" data-testid="mail-editor-image">
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
