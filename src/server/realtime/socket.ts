import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { SESSION_COOKIE } from '../../shared/constants.js';
import { parseCookies } from '../auth/sessions.js';
import type { AppContext, Broadcaster } from '../context.js';
import { viewFor } from '../rooms/view.js';

type AuthedRequest = IncomingMessage & { dgUserId?: string };

function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const forwarded = req.headers['x-forwarded-host'];
  const host = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() || req.headers.host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function attachRealtime(httpServer: HttpServer, ctx: AppContext): { io: Server; broadcaster: Broadcaster } {
  const io = new Server(httpServer, {
    path: '/socket.io',
    serveClient: false,
    allowRequest: (req, callback) => {
      if (!originAllowed(req)) {
        callback('unauthorized', false);
        return;
      }
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      ctx.sessions
        .resolve(token)
        .then((session) => {
          if (session) (req as AuthedRequest).dgUserId = session.userId;
          callback(session ? null : 'unauthorized', Boolean(session));
        })
        .catch(() => callback('unauthorized', false));
    },
  });

  io.use((socket, next) => {
    const userId = (socket.request as AuthedRequest).dgUserId;
    if (!userId) {
      next(new Error('unauthorized'));
      return;
    }
    socket.data.userId = userId;
    next();
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId as string;
    void socket.join(`user:${userId}`);
    const roomId = ctx.rooms.currentRoomId(userId);
    const room = roomId ? ctx.rooms.get(roomId) : undefined;
    if (room) socket.emit('room:state', viewFor(room, userId));
  });

  const broadcaster: Broadcaster = {
    roomChanged(roomId, userIds) {
      const room = ctx.rooms.get(roomId);
      for (const uid of userIds) {
        if (room) io.to(`user:${uid}`).emit('room:state', viewFor(room, uid));
        else io.to(`user:${uid}`).emit('room:closed', { roomId });
      }
    },
  };
  return { io, broadcaster };
}
