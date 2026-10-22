import { Alert, List } from '@mantine/core';
import { ApiError } from '../api.js';

export function ApiErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  const issues = error instanceof ApiError ? error.issues : [];
  const message = error instanceof Error ? error.message : 'Erreur inconnue';
  return (
    <Alert color="red" title={message} data-testid="api-error">
      {issues.length > 0 && (
        <List size="sm">
          {issues.map((i) => (
            <List.Item key={i}>{i}</List.Item>
          ))}
        </List>
      )}
    </Alert>
  );
}
