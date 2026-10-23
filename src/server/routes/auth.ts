import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppDb } from '../db/client.js';
import { cookieValue, SESSION_COOKIE, type InstanceRole } from '../auth/guard.js';
import { DUMMY_HASH, verifyPassword } from '../auth/passwords.js';
import { changePassword, createSession, createUser, deleteSession, deleteUser, findUserByEmail, listUsers, SESSION_DAYS } from '../auth/sessions.js';

/** Connexion des organisateurs et gestion des comptes (utiles en rôle serveur). */
export async function authRoutes(app: FastifyInstance, { db, role }: { db: AppDb; role: InstanceRole }) {
  const setCookie = (reply: FastifyReply, value: string, maxAge: number) =>
    reply.header('Set-Cookie', `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${role === 'serveur' ? '; Secure' : ''}`);

  app.get('/api/auth/me', async (req, reply) => {
    if (role === 'local') return { role, user: null };
    if (!req.user) return reply.status(401).send({ error: 'Non connecté.' });
    return { role, user: { email: req.user.email } };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const { email, password } = z.object({ email: z.string().max(200), password: z.string().max(200) }).parse(req.body);
    const user = findUserByEmail(db, email);
    const ok = verifyPassword(password, user?.passwordHash ?? DUMMY_HASH) && !!user;
    if (!ok) return reply.status(401).send({ error: 'E-mail ou mot de passe incorrect.' });
    setCookie(reply, createSession(db, user.id), SESSION_DAYS * 24 * 3600);
    return reply.status(204).send();
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = cookieValue(req, SESSION_COOKIE);
    if (token) deleteSession(db, token);
    setCookie(reply, '', 0);
    return reply.status(204).send();
  });

  const account = z.object({ email: z.string().max(200), password: z.string().max(200) });
  app.get('/api/users', async () => listUsers(db));
  app.post('/api/users', async (req, reply) => {
    const { email, password } = account.parse(req.body);
    const user = createUser(db, email, password);
    return reply.status(201).send({ id: user.id, email: user.email });
  });
  app.delete<{ Params: { userId: string } }>('/api/users/:userId', async (req, reply) => {
    if (req.user?.id === req.params.userId) return reply.status(400).send({ error: 'Vous ne pouvez pas supprimer votre propre compte.' });
    deleteUser(db, req.params.userId);
    return reply.status(204).send();
  });
  app.put('/api/users/me/password', async (req, reply) => {
    if (!req.user) return reply.status(400).send({ error: 'Aucun compte connecté.' });
    const { current, next } = z.object({ current: z.string().max(200), next: z.string().max(200) }).parse(req.body);
    changePassword(db, req.user.id, current, next, cookieValue(req, SESSION_COOKIE));
    return reply.status(204).send();
  });
}
