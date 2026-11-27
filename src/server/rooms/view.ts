import type { ChessColor, RoomSnapshot } from '../../shared/protocol.js';
import { roomStatus, type Room } from './roomManager.js';

/** The only place where room state leaves the server; output is tailored to the viewer. */
export function viewFor(room: Room, viewerUserId: string): RoomSnapshot {
  const snap: RoomSnapshot = {
    roomId: room.id,
    game: room.game,
    mode: room.mode,
    version: room.version,
    hostUserId: room.hostUserId,
    members: room.members.map((m) => ({ userId: m.userId, username: m.username })),
    capacity: room.capacity,
    status: roomStatus(room),
    you: { userId: viewerUserId },
  };
  if (room.chess) {
    const c = room.chess;
    let yourColor: ChessColor | null = null;
    if (c.players.red?.userId === viewerUserId) yourColor = 'red';
    else if (c.players.black?.userId === viewerUserId) yourColor = 'black';
    snap.chess = {
      gameId: c.id,
      status: c.status,
      players: {
        red: c.players.red ? { userId: c.players.red.userId, username: c.players.red.username } : null,
        black: c.players.black ? { userId: c.players.black.userId, username: c.players.black.username } : null,
      },
      yourColor,
      turn: c.turn,
    };
  }
  if (room.poker) {
    snap.poker = {
      handId: null,
      handNumber: room.poker.handNumber,
      stage: 'idle',
      seats: room.poker.seats.flatMap((s, seat) =>
        s ? [{ seat, kind: s.kind, ...(s.userId ? { userId: s.userId } : {}), name: s.name }] : [],
      ),
    };
  }
  return snap;
}
