import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { checkMailHtml } from '../../api.js';

/**
 * Avant d'enregistrer un message mis en forme : demande au filtre du serveur ce qu'il va retirer et le dit, puis enregistre.
 * Le serveur filtre de toute façon : si la vérification échoue, l'enregistrement part quand même et dira lui-même ce qui ne va pas.
 */
export function useRemovedNotice() {
  const [checking, setChecking] = useState(false);
  const noticeThenSave = (mail: { body: string; format?: 'html' }, save: () => void) => {
    if (mail.format !== 'html') {
      save();
      return;
    }
    setChecking(true);
    void checkMailHtml(mail.body)
      .then(({ removed }) => {
        if (removed.length > 0) notifications.show({ color: 'orange', message: `Retiré du message : ${removed.join(', ')}.` });
      })
      .catch(() => undefined)
      .finally(() => {
        setChecking(false);
        save();
      });
  };
  return { checking, noticeThenSave };
}
