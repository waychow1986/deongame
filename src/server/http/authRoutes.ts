import { Router, type Request } from 'express';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { clearSessionCookie, requireAuth, setSessionCookie } from '../auth/middleware.js';
import { parseCookies } from '../auth/sessions.js';
import { SESSION_COOKIE } from '../../shared/constants.js';
import { UsernameTakenError, type UserRow } from '../db/users.js';
import { AppError } from '../errors.js';
import type { AppContext } from '../context.js';
import type { UserDto } from '../../shared/protocol.js';

const MAX_FIELD_LENGTH = 200;

function readCredentials(req: Request): { username: string; password: string } {
  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null) throw new AppError('VALIDATION_FAILED');
  const { username, password } = body as Record<string, unknown>;
  if (username !== undefined && username !== null && typeof username !== 'string') throw new AppError('VALIDATION_FAILED');
  if (password !== undefined && password !== null && typeof password !== 'string') throw new AppError('VALIDATION_FAILED');
  if (typeof username !== 'string' || username.trim() === '') throw new AppError('VALIDATION_FAILED', '用户名为必填项');
  if (typeof password !== 'string' || password.trim() === '') throw new AppError('VALIDATION_FAILED', '密码为必填项');
  if (username.length > MAX_FIELD_LENGTH) throw new AppError('VALIDATION_FAILED', `用户名不能超过 ${MAX_FIELD_LENGTH} 个字符`);
  if (password.length > MAX_FIELD_LENGTH) throw new AppError('VALIDATION_FAILED', `密码不能超过 ${MAX_FIELD_LENGTH} 个字符`);
  return { username, password };
}

export function toUserDto(ctx: AppContext, user: UserRow): UserDto {
  return {
    id: user.id,
    username: user.username,
    rating: user.rating,
    chips: Number(user.chips_balance),
    currentRoomId: ctx.rooms.currentRoomId(user.id),
    activeRoomId: ctx.rooms.activeRoomId(user.id),
  };
}

export function authRoutes(ctx: AppContext): Router {
  const router = Router();

  router.post('/api/auth/register', async (req, res) => {
    const { username, password } = readCredentials(req);
    const hash = await hashPassword(password);
    let user: UserRow;
    try {
      user = await ctx.users.create(username, hash);
    } catch (err) {
      if (err instanceof UsernameTakenError) throw new AppError('USERNAME_TAKEN');
      throw err;
    }
    const session = await ctx.sessions.create(user.id);
    setSessionCookie(ctx, res, session.token, session.expiresAt);
    ctx.logger.info({ event: 'user_registered', userId: user.id }, 'user registered');
    res.status(201).json({ user: toUserDto(ctx, user) });
  });

  router.post('/api/auth/login', async (req, res) => {
    const { username, password } = readCredentials(req);
    const user = await ctx.users.findByUsername(username);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      ctx.logger.info({ event: 'login_failed' }, 'login failed');
      throw new AppError('INVALID_CREDENTIALS');
    }
    const session = await ctx.sessions.create(user.id);
    setSessionCookie(ctx, res, session.token, session.expiresAt);
    ctx.logger.info({ event: 'user_logged_in', userId: user.id }, 'user logged in');
    res.status(200).json({ user: toUserDto(ctx, user) });
  });

  router.post('/api/auth/logout', async (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const userId = await ctx.sessions.revoke(token);
    clearSessionCookie(ctx, res);
    if (userId) ctx.logger.info({ event: 'user_logged_out', userId }, 'user logged out');
    res.status(204).end();
  });

  router.get('/api/me', requireAuth(ctx), (req, res) => {
    res.json({ user: toUserDto(ctx, req.user as UserRow) });
  });

  return router;
}
