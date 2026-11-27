import { Router, type Request, type Response } from 'express';
import type { PlayerAction } from '../../shared/poker/index.js';
import type { AppContext } from '../context.js';
import { AppError } from '../errors.js';
import type { Room } from '../rooms/roomManager.js';
import { viewFor } from '../rooms/view.js';
import { member, roomIdParam } from './roomRoutes.js';

const ACTION_TYPES = new Set(['fold', 'check', 'call', 'bet', 'raise']);

function parseAction(req: Request): PlayerAction {
  const b = req.body as unknown;
  const { type, amount } = b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
  if (typeof type !== 'string' || !ACTION_TYPES.has(type)) throw new AppError('VALIDATION_FAILED');
  if (type === 'bet' || type === 'raise') {
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) throw new AppError('VALIDATION_FAILED');
    return { type, amount };
  }
  return { type: type as PlayerAction['type'] };
}

/** Poker endpoints; authentication is applied by the enclosing room router. */
export function pokerRoutes(ctx: AppContext): Router {
  const router = Router();

  function respond(res: Response, room: Room, userId: string, event: string): void {
    ctx.logger.info({ event, userId, roomId: room.id, handId: room.poker?.hand?.id }, event);
    ctx.broadcaster.roomChanged(
      room.id,
      room.members.map((m) => m.userId).filter((id) => id !== userId),
    );
    res.json({ room: viewFor(room, userId) });
  }

  router.post('/api/rooms/:id/poker/start', async (req, res) => {
    const roomId = roomIdParam(req);
    const me = member(req);
    const room = await ctx.rooms.pokerStart(me.userId, roomId);
    respond(res, room, me.userId, 'poker_hand_started');
  });

  router.post('/api/rooms/:id/poker/action', async (req, res) => {
    const roomId = roomIdParam(req);
    const action = parseAction(req);
    const me = member(req);
    const room = await ctx.rooms.pokerAction(me.userId, roomId, action);
    respond(res, room, me.userId, 'poker_action');
  });

  return router;
}
