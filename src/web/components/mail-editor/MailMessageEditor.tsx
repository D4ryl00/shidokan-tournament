import { Link, RichTextEditor } from '@mantine/tiptap';
import { Color, TextStyle } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import StarterKit from '@tiptap/starter-kit';
import { useEditor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import { useRef } from 'react';
import { mailBodyToHtml } from '../../../domain/mail-template.js';

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
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false, code: false, horizontalRule: false, strike: false, link: false, heading: { levels: [1, 2, 3] } }),
      // Les types de @mantine/tiptap (CommonJS) et de @tiptap (ESM) sont deux copies distinctes pour TypeScript : ce sont les mêmes modules à l'exécution.
      Link.configure({ openOnClick: false, isAllowedUri: (url, ctx) => url === '{lien}' || ctx.defaultValidate(url) }) as unknown as AnyExtension,
      TextStyle,
      Color,
      Highlight,
      TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right'] }),
    ],
    content: mailBodyToHtml(value),
    editable: !readOnly,
    immediatelyRender: false,
    onUpdate: ({ editor: e }) => {
      if (!sourceMode.current) onChange({ body: e.getHTML(), format: 'html' });
    },
  });
  return (
    <RichTextEditor
      editor={editor as never}
      labels={LABELS}
      onSourceCodeTextSwitch={(active) => { sourceMode.current = active; onSourceModeChange?.(active); }}
      data-testid="mail-editor"
    >
      {!readOnly && (
        <RichTextEditor.Toolbar sticky stickyOffset={0}>
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
            <RichTextEditor.SourceCode />
          </RichTextEditor.ControlsGroup>
        </RichTextEditor.Toolbar>
      )}
      {/* Fond blanc et texte foncé dans les deux thèmes : c'est ce que verra le destinataire. */}
      <RichTextEditor.Content style={{ background: '#fff', color: '#1a1a1a' }} />
    </RichTextEditor>
  );
}
