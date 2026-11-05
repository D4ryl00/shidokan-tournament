import { Loader } from '@mantine/core';
import { lazy, Suspense } from 'react';
import type { MailMessageEditorProps } from './MailMessageEditor.js';

const Editor = lazy(() => import('./MailMessageEditor.js'));

/** Chargé à la demande : la page publique des clubs n'embarque pas l'éditeur. */
export function MailMessageEditor(props: MailMessageEditorProps) {
  return (
    <Suspense fallback={<Loader size="sm" />}>
      <Editor {...props} />
    </Suspense>
  );
}
