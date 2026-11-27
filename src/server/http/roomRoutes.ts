import { Router, type Request } from 'express';
import { requireAuth } from '../auth/middleware.js';
import type { UserRow } from '../db/users.js';
import { AppError } from '../errors.js';
import type { AppContext } from '../context.js';
import { viewFor } from '../rooms/view.js';
import { chessRoutes } from './chessRoutes.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function roomIdParam(req: Request): string {
  const id = req.params.id;
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new AppError('ROOM_NOT_FOUND');
  return id.toLowerCase();
}

export function member(req: Request): { userId: string; username: string } {
  const user = req.user as UserRow;
  return { userId: user.id, username: user.username };
}

export function roomRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use('/api/rooms', requireAuth(ctx));

  router.get('/api/rooms', (_req, res) => {
    res.json({ rooms: ctx.rooms.list() });
  });

  router.post('/api/rooms', async (req, res) => {
    const game = (req.body as Record<string, unknown> | null)?.game;
    if (game !== 'chess' && game !== 'poker') throw new AppError('VALIDATION_FAILED');
    const me = member(req);
    const room = await ctx.rooms.create(me, game);
    ctx.logger.info({ event: 'room_created', userId: me.userId, roomId: room.id, game }, 'room created');
    res.status(201).json({ room: viewFor(room, me.userId) });
  });

  router.post('/api/rooms/:id/join', async (req, res) => {
    const roomId = roomIdParam(req);
    const me = member(req);
    const room = await ctx.rooms.join(me, roomId);
    ctx.logger.info({ event: 'room_joined', userId: me.userId, roomId }, 'room joined');
    ctx.broadcaster.roomChanged(room.id, room.members.map((m) => m.userId).filter((id) => id !== me.userId));
    res.json({ room: viewFor(room, me.userId) });
  });

  router.post('/api/rooms/:id/leave', async (req, res) => {
    const roomId = roomIdParam(req);
    const me = member(req);
    const { room, affectedUserIds } = await ctx.rooms.leave(me.userId, roomId);
    ctx.logger.info({ event: 'room_left', userId: me.userId, roomId }, 'room left');
    ctx.broadcaster.roomChanged(room.id, affectedUserIds);
    res.json({});
  });

  router.get('/api/rooms/:id/state', (req, res) => {
    const roomId = roomIdParam(req);
    const me = member(req);
    const room = ctx.rooms.get(roomId);
    if (!room) throw new AppError('ROOM_NOT_FOUND');
    if (!room.members.some((m) => m.userId === me.userId)) throw new AppError('NOT_IN_ROOM');
    res.json({ room: viewFor(room, me.userId) });
  });

  // Mounted after requireAuth so the chess endpoints share the same authentication.
  router.use(chessRoutes(ctx));

  return router;
}
