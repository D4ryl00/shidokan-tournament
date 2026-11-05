import { Link, RichTextEditor } from '@mantine/tiptap';
import { Color, TextStyle } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import StarterKit from '@tiptap/starter-kit';
import FileHandler from '@tiptap/extension-file-handler';
import Image from '@tiptap/extension-image';
import { useEditor, useEditorState } from '@tiptap/react';
import type { AnyExtension, Editor } from '@tiptap/core';
import { Button, Group, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useRef } from 'react';
import { MAIL_IMAGE_LIMITS } from '../../../domain/mail-images.js';
import { mailBodyToHtml } from '../../../domain/mail-template.js';
import { checkMailHtml } from '../../api.js';
import { ImageControl, insertImages } from './ImageControl.js';
import { pastedLosses } from './images.js';

export interface MailBody {
  body: string;
  format: 'html';
}

/** Libellés français de la barre de Mantine. */
const LABELS = {
  boldControlLabel: 'Gras',
  italicControlLabel: 'Italique',
  underlineControlLabel: 'Souligné',
  clearFormattingControlLabel: 'Effacer la mise en forme',
  linkControlLabel: 'Lien',
  unlinkControlLabel: 'Retirer le lien',
  bulletListControlLabel: 'Liste à puces',
  orderedListControlLabel: 'Liste numérotée',
  h1ControlLabel: 'Titre 1',
  h2ControlLabel: 'Titre 2',
  h3ControlLabel: 'Titre 3',
  blockquoteControlLabel: 'Citation',
  alignLeftControlLabel: 'Aligner à gauche',
  alignCenterControlLabel: 'Centrer',
  alignRightControlLabel: 'Aligner à droite',
  colorPickerControlLabel: 'Couleur du texte',
  unsetColorControlLabel: 'Retirer la couleur',
  highlightControlLabel: 'Surligner',
  undoControlLabel: 'Annuler',
  redoControlLabel: 'Rétablir',
  sourceCodeControlLabel: 'Code source (HTML)',
  colorControlLabel: (color: string) => `Couleur ${color}`,
  linkEditorInputLabel: 'Adresse du lien',
  linkEditorInputPlaceholder: 'https://… ou {lien}',
  linkEditorExternalLink: 'S’ouvre dans un nouvel onglet',
  linkEditorInternalLink: 'S’ouvre dans le même onglet',
  linkEditorSave: 'Valider',
  colorPickerCancel: 'Annuler',
  colorPickerClear: 'Effacer',
  colorPickerColorPicker: 'Choisir une couleur',
  colorPickerPalette: 'Palette',
  colorPickerSave: 'Valider',
  colorPickerColorLabel: (color: string) => `Couleur ${color}`,
};

/** Image du message : dans le texte, uniquement celles que l'application stocke, avec une largeur d'affichage. */
const MailImage = Image.extend({
  parseHTML: () => [{ tag: 'img[src^="/api/mail-images/"]' }],
}).configure({ inline: true, allowBase64: false });

const SIZES = [
  { id: 'small', label: 'Petite', width: MAIL_IMAGE_LIMITS.widths.small },
  { id: 'medium', label: 'Moyenne', width: MAIL_IMAGE_LIMITS.widths.medium },
  { id: 'full', label: 'Pleine largeur', width: MAIL_IMAGE_LIMITS.widths.full },
];

/** Ligne sous la barre quand une image est sélectionnée : sa largeur d'affichage. */
function ImageSizeRow({ editor }: { editor: Editor }) {
  const width = useEditorState({
    editor,
    selector: ({ editor: e }) => (e.isActive('image') ? Number(e.getAttributes('image').width) || null : undefined),
  });
  if (width === undefined) return null;
  return (
    <Group gap="xs" px="xs" py={6} data-testid="mail-image-sizes" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
      <Text size="sm">Taille de l’image :</Text>
      {SIZES.map((x) => (
        <Button key={x.id} size="compact-xs" variant={width === x.width ? 'filled' : 'default'} data-testid={`mail-image-size-${x.id}`}
          onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().updateAttributes('image', { width: x.width }).run()}>
          {x.label}
        </Button>
      ))}
    </Group>
  );
}

const SOURCE_LABEL = LABELS.sourceCodeControlLabel;
const PALETTE = ['#000000', '#c0392b', '#e67e22', '#f1c40f', '#27ae60', '#1c5fb8', '#8e44ad', '#7f8c8d'];

/**
 * Éditeur du message aux clubs. `value` ne sert qu'à l'ouverture : pour repartir d'un autre message, le parent remonte l'éditeur (clé).
 * `onChange` n'est appelé que sur une modification de l'utilisateur, jamais à l'ouverture : un message non touché n'est pas réenregistré.
 */
export interface MailMessageEditorProps {
  value: { body: string; format?: 'html' };
  onChange: (v: MailBody) => void;
  readOnly?: boolean;
  onSourceModeChange?: (active: boolean) => void;
}

export default function MailMessageEditor({ value, onChange, readOnly = false, onSourceModeChange }: MailMessageEditorProps) {
  // En mode code, le document de l'éditeur est une zone de texte : il ne doit jamais remonter comme message.
  const sourceMode = useRef(false);
  // Code HTML à l'entrée du mode code et code au moment de la sortie (l'éditeur visuel perd ce qu'il ne connaît pas en y revenant).
  const codeAtEntry = useRef('');
  const codeAtExit = useRef('');
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false, code: false, horizontalRule: false, strike: false, link: false, heading: { levels: [1, 2, 3] } }),
      // Les types de @mantine/tiptap (CommonJS) et de @tiptap (ESM) sont deux copies distinctes pour TypeScript : ce sont les mêmes modules à l'exécution.
      Link.configure({ openOnClick: false, isAllowedUri: (url, ctx) => url === '{lien}' || ctx.defaultValidate(url) }) as unknown as AnyExtension,
      TextStyle,
      Color,
      Highlight,
      TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right'] }),
      MailImage,
      FileHandler.configure({
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'],
        // Un collage qui porte du HTML (Word, un site) passe par le collage ordinaire ; seul un fichier seul devient une image.
        onPaste: (e, files, html) => { if (!html) void insertImages(e, files); },
        onDrop: (e, files, pos) => void insertImages(e, files, pos),
      }),
    ],
    editorProps: {
      transformPastedHTML: (html) => {
        const losses = pastedLosses(html);
        if (losses.length > 0) notifications.show({ color: 'orange', message: `Retiré du collage : ${losses.join(', ')}.` });
        return html;
      },
    },
    content: mailBodyToHtml(value),
    editable: !readOnly,
    immediatelyRender: false,
    onUpdate: ({ editor: e }) => {
      if (!sourceMode.current) onChange({ body: e.getHTML(), format: 'html' });
    },
  });

  // Mantine remplace le contenu avant d'appeler ce rappel : à la sortie, le code a déjà été relu (clic capturé plus bas).
  const switchSourceMode = (active: boolean) => {
    sourceMode.current = active;
    if (active) {
      codeAtEntry.current = editor?.getText() ?? '';
      onSourceModeChange?.(true);
      return;
    }
    const code = codeAtExit.current;
    if (!editor || code === codeAtEntry.current) { onSourceModeChange?.(false); return; } // code intact : rien à signaler
    void checkMailHtml(code)
      .then(({ html, removed }) => {
        // Compte rendu direct : si le code nettoyé donne le même document, l'éditeur n'émet aucune mise à jour.
        editor.commands.setContent(html, { emitUpdate: false });
        onChangeRef.current({ body: editor.getHTML(), format: 'html' });
        if (removed.length > 0) notifications.show({ color: 'orange', message: `Retiré du code : ${removed.join(', ')}.` });
      })
      .catch(() => {
        // Le serveur filtre de toute façon à l'enregistrement : on garde ce que l'éditeur a compris du code.
        onChangeRef.current({ body: editor.getHTML(), format: 'html' });
        notifications.show({ color: 'red', message: 'Le code n’a pas pu être vérifié.' });
      })
      .finally(() => onSourceModeChange?.(false));
  };

  return (
    <RichTextEditor
      editor={editor as never}
      labels={LABELS}
      onSourceCodeTextSwitch={switchSourceMode}
      data-testid="mail-editor"
    >
      {!readOnly && (
        <RichTextEditor.Toolbar sticky stickyOffset={0}
          onClickCapture={(e: React.MouseEvent) => {
            // Avant que Mantine ne remplace le contenu, dans un sens comme dans l'autre : le document intermédiaire n'est jamais un message.
            if (!editor || !(e.target as HTMLElement).closest(`[aria-label="${SOURCE_LABEL}"]`)) return;
            if (sourceMode.current) codeAtExit.current = editor.getText(); // sortie : le code tel qu'il est écrit
            sourceMode.current = true;
          }}>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.Undo />
            <RichTextEditor.Redo />
          </RichTextEditor.ControlsGroup>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.H1 />
            <RichTextEditor.H2 />
            <RichTextEditor.H3 />
          </RichTextEditor.ControlsGroup>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.Bold />
            <RichTextEditor.Italic />
            <RichTextEditor.Underline />
            <RichTextEditor.ClearFormatting />
          </RichTextEditor.ControlsGroup>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.ColorPicker colors={PALETTE} />
            <RichTextEditor.UnsetColor />
            <RichTextEditor.Highlight />
          </RichTextEditor.ControlsGroup>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.BulletList />
            <RichTextEditor.OrderedList />
            <RichTextEditor.Blockquote />
          </RichTextEditor.ControlsGroup>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.AlignLeft />
            <RichTextEditor.AlignCenter />
            <RichTextEditor.AlignRight />
          </RichTextEditor.ControlsGroup>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.Link />
            <RichTextEditor.Unlink />
          </RichTextEditor.ControlsGroup>
          <RichTextEditor.ControlsGroup>
            <ImageControl />
          </RichTextEditor.ControlsGroup>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.SourceCode />
          </RichTextEditor.ControlsGroup>
        </RichTextEditor.Toolbar>
      )}
      {!readOnly && editor && <ImageSizeRow editor={editor} />}
      {/* Fond blanc et texte foncé dans les deux thèmes : c'est ce que verra le destinataire. */}
      <RichTextEditor.Content style={{ background: '#fff', color: '#1a1a1a' }} />
    </RichTextEditor>
  );
}
