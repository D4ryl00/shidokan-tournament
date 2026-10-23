import { Button, Card, Center, Group, PasswordInput, Stack, TextInput, Title } from '@mantine/core';
import { useState } from 'react';
import { useLogin } from '../api.js';
import { ApiErrorAlert } from '../components/ApiErrorAlert.js';
import { Logo } from '../components/Logo.js';

/** Connexion des organisateurs (application en ligne). */
export function LoginPage() {
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <Center mih="100vh" p="md">
      <Card withBorder w={380} maw="100%">
        <form onSubmit={(e) => { e.preventDefault(); login.mutate({ email, password }); }}>
          <Stack>
            <Group wrap="nowrap">
              <Logo size={48} />
              <Title order={3}>Shidokan France — Compétitions</Title>
            </Group>
            <TextInput data-testid="login-email" label="E-mail" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
            <PasswordInput data-testid="login-password" label="Mot de passe" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
            <ApiErrorAlert error={login.error} />
            <Button data-testid="login-submit" type="submit" loading={login.isPending}>Se connecter</Button>
          </Stack>
        </form>
      </Card>
    </Center>
  );
}
