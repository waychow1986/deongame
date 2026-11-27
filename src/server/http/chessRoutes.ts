import { Router, type Request, type Response } from 'express';
import type { AppContext } from '../context.js';
import { AppError } from '../errors.js';
import type { Room } from '../rooms/roomManager.js';
import { viewFor } from '../rooms/view.js';
import { member, roomIdParam } from './roomRoutes.js';

const POS_RE = /^[a-i][0-9]$/;

function body(req: Request): Record<string, unknown> {
  const b = req.body as unknown;
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
}

/** Chess endpoints; authentication is applied by the enclosing room router. */
export function chessRoutes(ctx: AppContext): Router {
  const router = Router();

  function respond(res: Response, room: Room, userId: string, event: string): void {
    ctx.logger.info({ event, userId, roomId: room.id, gameId: room.chess?.id }, event);
    ctx.broadcaster.roomChanged(
      room.id,
      room.members.map((m) => m.userId).filter((id) => id !== userId),
    );
    res.json({ room: viewFor(room, userId) });
  }

  router.post('/api/rooms/:id/chess/move', async (req, res) => {
    const roomId = roomIdParam(req);
    const { from, to } = body(req);
    if (typeof from !== 'string' || typeof to !== 'string' || !POS_RE.test(from) || !POS_RE.test(to)) {
      throw new AppError('VALIDATION_FAILED');
    }
    const me = member(req);
    const room = await ctx.rooms.chessMove(me.userId, roomId, from, to);
    respond(res, room, me.userId, 'chess_move');
  });

  router.post('/api/rooms/:id/chess/resign', async (req, res) => {
    const roomId = roomIdParam(req);
    const me = member(req);
    const room = await ctx.rooms.chessResign(me.userId, roomId);
    respond(res, room, me.userId, 'chess_resign');
  });

  router.post('/api/rooms/:id/chess/draw-offer', async (req, res) => {
    const roomId = roomIdParam(req);
    const me = member(req);
    const room = await ctx.rooms.chessDrawOffer(me.userId, roomId);
    respond(res, room, me.userId, 'chess_draw_offer');
  });

  router.post('/api/rooms/:id/chess/draw-response', async (req, res) => {
    const roomId = roomIdParam(req);
    const { accept } = body(req);
    if (typeof accept !== 'boolean') throw new AppError('VALIDATION_FAILED');
    const me = member(req);
    const room = await ctx.rooms.chessDrawResponse(me.userId, roomId, accept);
    respond(res, room, me.userId, 'chess_draw_response');
  });

  return router;
}
