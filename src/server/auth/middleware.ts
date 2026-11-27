import type { NextFunction, Request, Response } from 'express';
import { SESSION_COOKIE } from '../../shared/constants.js';
import type { UserRow } from '../db/users.js';
import { AppError } from '../errors.js';
import type { AppContext } from '../context.js';
import { parseCookies } from './sessions.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: UserRow;
  }
}

export function setSessionCookie(ctx: AppContext, res: Response, token: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: ctx.config.cookieSecure,
    expires: expiresAt,
  });
}

export function requireAuth(ctx: AppContext) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      const session = await ctx.sessions.resolve(token);
      if (!session) throw new AppError('UNAUTHENTICATED');
      const user = await ctx.users.findById(session.userId);
      if (!user) throw new AppError('UNAUTHENTICATED');
      if (session.renewedUntil && token) setSessionCookie(ctx, res, token, session.renewedUntil);
      req.user = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}
