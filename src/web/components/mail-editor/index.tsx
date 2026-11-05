import { Alert, Loader } from '@mantine/core';
import { Component, lazy, Suspense, type ReactNode } from 'react';
import type { MailMessageEditorProps } from './MailMessageEditor.js';

const Editor = lazy(() => import('./MailMessageEditor.js'));

/** Un morceau de l'éditeur qui ne charge plus (l'application a été mise à jour entre-temps) : un message à sa place, le reste de la page reste. */
class EditorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? <Alert color="red" data-testid="mail-editor-failed">L’éditeur n’a pas pu se charger : rechargez la page.</Alert> : this.props.children;
  }
}

/** Chargé à la demande : la page publique des clubs n'embarque pas l'éditeur. */
export function MailMessageEditor(props: MailMessageEditorProps) {
  return (
    <EditorBoundary>
      <Suspense fallback={<Loader size="sm" />}>
        <Editor {...props} />
      </Suspense>
    </EditorBoundary>
  );
}
