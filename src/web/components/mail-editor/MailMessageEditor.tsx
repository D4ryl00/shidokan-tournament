import { Link, RichTextEditor } from '@mantine/tiptap';
import { Color, TextStyle } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import StarterKit from '@tiptap/starter-kit';
import FileHandler from '@tiptap/extension-file-handler';
import Image from '@tiptap/extension-image';
import { useEditor, useEditorState } from '@tiptap/react';
import type { AnyExtension, Editor } from '@tiptap/core';
import { Button, Group, Loader, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { EditorState } from '@tiptap/pm/state';
import { useEffect, useRef, useState } from 'react';
import { MAIL_IMAGE_LIMITS } from '../../../domain/mail-images.js';
import { mailBodyToHtml, mailLinkAllowed, normalizeMailLink } from '../../../domain/mail-template.js';
import { checkMailHtml } from '../../api.js';
import { ImageControl, insertImages } from './ImageControl.js';
import { pastedLosses, pastedOnlyAnImage } from './images.js';

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

const LINK_REFUSED = 'Adresse de lien refusée : écrivez une adresse en https://, une adresse e-mail ou {lien}.';

/**
 * Lien du message : la même règle que le filtre du serveur, pour qu'aucun lien posé ici ne perde son adresse à l'enregistrement.
 * `www.…` et `x@y.fr` sont complétés à la pose, d'où qu'ils viennent ; une adresse refusée est dite, au lieu d'un échec silencieux.
 * Les types de @mantine/tiptap (CommonJS) et de @tiptap (ESM) sont deux copies distinctes pour TypeScript : ce sont les mêmes modules à l'exécution.
 */
const MailLink = Link.extend({
  addCommands() {
    const commands = this.parent?.() ?? {};
    return {
      ...commands,
      setLink: (attributes) => (props) => {
        const href = normalizeMailLink(attributes.href);
        if (!mailLinkAllowed(href)) {
          if (props.dispatch) notifications.show({ color: 'red', message: LINK_REFUSED });
          return false;
        }
        return commands.setLink!({ ...attributes, href })(props);
      },
    };
  },
}).configure({ openOnClick: false, isAllowedUri: (url) => mailLinkAllowed(url ?? '') }) as unknown as AnyExtension;

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
const BLOCKED_BY_CODE = 'Revenez à l’éditeur pour enregistrer.';
const BLOCKED_BY_UPLOAD = 'Image en cours d’envoi : vous pourrez enregistrer ensuite.';

/**
 * Éditeur du message aux clubs. `value` ne sert qu'à l'ouverture : pour repartir d'un autre message, le parent remonte l'éditeur (clé).
 * `onChange` n'est appelé que sur une modification de l'utilisateur, jamais à l'ouverture : un message non touché n'est pas réenregistré.
 */
export interface MailMessageEditorProps {
  value: { body: string; format?: 'html' };
  onChange: (v: MailBody) => void;
  readOnly?: boolean;
  /** Pourquoi le message ne doit pas être enregistré maintenant (mode code, image en cours d'envoi), ou null. */
  onSaveBlockChange?: (reason: string | null) => void;
}

export default function MailMessageEditor({ value, onChange, readOnly = false, onSaveBlockChange }: MailMessageEditorProps) {
  // En mode code, le document de l'éditeur est une zone de texte : il ne doit jamais remonter comme message.
  const sourceMode = useRef(false);
  // Code HTML à l'entrée du mode code et code au moment de la sortie (l'éditeur visuel perd ce qu'il ne connaît pas en y revenant).
  const codeAtEntry = useRef('');
  const codeAtExit = useRef('');
  // Mode code ou sortie en cours : ni image, ni annuler/rétablir (ils toucheraient le code, pas le message).
  const locked = useRef(false);
  const [lockedView, setLockedView] = useState(false);
  const setLocked = (v: boolean) => { locked.current = v; setLockedView(v); };
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Images en cours d'envoi : un enregistrement à ce moment les perdrait.
  const [uploading, setUploading] = useState(0);
  const addFiles = (e: Editor, files: File[], pos?: number) => {
    setUploading((n) => n + 1);
    void insertImages(e, files, pos, () => locked.current).finally(() => setUploading((n) => n - 1));
  };
  const saveBlock = lockedView ? BLOCKED_BY_CODE : uploading > 0 ? BLOCKED_BY_UPLOAD : null;
  useEffect(() => onSaveBlockChange?.(saveBlock), [saveBlock]); // eslint-disable-line react-hooks/exhaustive-deps
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false, code: false, horizontalRule: false, strike: false, link: false, heading: { levels: [1, 2, 3] } }),
      MailLink,
      TextStyle,
      Color,
      Highlight,
      TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right'] }),
      MailImage,
      FileHandler.configure({
        // Pas de liste de types ici : un fichier hors liste doit atteindre le refus de `prepareImage`, sinon le navigateur l'ouvre à la place de la page.
        // Un collage qui porte du HTML (Word, un site) passe par le collage ordinaire ; un fichier seul devient une image (image seule : voir `handleDOMEvents`).
        onPaste: (e, files, html) => { if (!html) addFiles(e, files); },
        onDrop: (e, files, pos) => addFiles(e, files, pos),
      }),
    ],
    editorProps: {
      handleDOMEvents: {
        // « Copier l'image » met un fichier et `<img src=…>` dans le presse-papiers : c'est le fichier qu'on veut. Avant le collage ordinaire, qui lirait le HTML.
        paste: (view, event) => {
          const files = Array.from(event.clipboardData?.files ?? []);
          if (!view.editable || locked.current || !files.length || !editorRef.current || !pastedOnlyAnImage(event.clipboardData?.getData('text/html') ?? '')) return false;
          event.preventDefault();
          addFiles(editorRef.current, files);
          return true;
        },
      },
      // Annuler/rétablir au clavier : sans effet en mode code.
      handleKeyDown: (_view, event) => locked.current && (event.metaKey || event.ctrlKey) && ['z', 'y'].includes(event.key.toLowerCase()),
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
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  // Mantine remplace le contenu avant d'appeler ce rappel : à la sortie, le code a déjà été relu (clic capturé plus bas).
  // Le passage par le mode code ne doit pas rester dans l'historique : « Annuler » rendrait le code comme texte.
  const forgetHistory = () => {
    if (editor) editor.view.updateState(EditorState.create({ doc: editor.state.doc, plugins: editor.state.plugins }));
  };
  const endExit = () => setLocked(false);
  const switchSourceMode = (active: boolean) => {
    sourceMode.current = active;
    if (active) {
      codeAtEntry.current = editor?.getText() ?? '';
      return;
    }
    const code = codeAtExit.current;
    if (!editor || code === codeAtEntry.current) { forgetHistory(); endExit(); return; } // code intact : rien à signaler
    void checkMailHtml(code)
      .then(({ html, removed }) => {
        // Compte rendu direct : si le code nettoyé donne le même document, l'éditeur n'émet aucune mise à jour.
        editor.commands.setContent(html, { emitUpdate: false });
        forgetHistory();
        onChangeRef.current({ body: editor.getHTML(), format: 'html' });
        if (removed.length > 0) notifications.show({ color: 'orange', message: `Retiré du code : ${removed.join(', ')}.` });
      })
      .catch(() => {
        // Le serveur filtre de toute façon à l'enregistrement : on garde ce que l'éditeur a compris du code.
        forgetHistory();
        onChangeRef.current({ body: editor.getHTML(), format: 'html' });
        notifications.show({ color: 'red', message: 'Le code n’a pas pu être vérifié.' });
      })
      .finally(endExit);
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
            setLocked(true);
          }}>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.Undo disabled={lockedView} />
            <RichTextEditor.Redo disabled={lockedView} />
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
            <ImageControl disabled={lockedView} onFiles={addFiles} />
          </RichTextEditor.ControlsGroup>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.SourceCode />
          </RichTextEditor.ControlsGroup>
        </RichTextEditor.Toolbar>
      )}
      {!readOnly && editor && <ImageSizeRow editor={editor} />}
      {uploading > 0 && (
        <Group gap="xs" px="xs" py={6} data-testid="mail-image-uploading" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
          <Loader size="xs" />
          <Text size="sm">Envoi de l’image…</Text>
        </Group>
      )}
      {/* Fond blanc et texte foncé dans les deux thèmes : c'est ce que verra le destinataire. */}
      <RichTextEditor.Content style={{ background: '#fff', color: '#1a1a1a' }} />
    </RichTextEditor>
  );
}
