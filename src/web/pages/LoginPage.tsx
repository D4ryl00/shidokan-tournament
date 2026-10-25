import { Button, Card, Center, Modal, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { useState } from 'react';
import { useLogin } from '../api.js';
import { useDocumentTitle } from '../documentTitle.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { Logo } from '../components/Logo.js';

/** Formulaire de connexion (écran de connexion, ou fenêtre de reconnexion après une session perdue). */
function LoginForm() {
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); login.mutate({ email, password }); }}>
      <Stack>
        <TextInput data-testid="login-email" label="E-mail" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
        <PasswordInput data-testid="login-password" label="Mot de passe" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
        <ApiErrorAlert error={login.error} />
        <Button data-testid="login-submit" type="submit" loading={login.isPending}>Se connecter</Button>
      </Stack>
    </form>
  );
}

/** Connexion des organisateurs (application en ligne). */
export function LoginPage() {
  useDocumentTitle('Connexion');
  return (
    <Center mih="100vh" p="md" style={{ background: 'var(--sk-bg)' }}>
      <Stack align="center" gap="lg" w={400} maw="100%">
        <Stack align="center" gap="xs">
          <Logo size={96} />
          <Title order={1} fz={28} ta="center">Shidokan France</Title>
          <Text c="dimmed" size="sm">Compétitions — connexion des organisateurs</Text>
        </Stack>
        <Card withBorder padding="xl" w="100%">
          <LoginForm />
        </Card>
      </Stack>
    </Center>
  );
}

/** Session perdue en cours de route : reconnexion par-dessus l'écran, dont la saisie est gardée. */
export function ReloginModal() {
  return (
    <Modal opened onClose={() => undefined} withCloseButton={false} closeOnClickOutside={false} closeOnEscape={false} title="Session expirée : reconnectez-vous" data-testid="relogin">
      <LoginForm />
    </Modal>
  );
}
