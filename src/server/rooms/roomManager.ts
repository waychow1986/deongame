import { randomUUID } from 'node:crypto';
import { CHESS_CAPACITY, POKER_CAPACITY } from '../../shared/constants.js';
import type { ChessColor, GameType, RoomListItem, RoomMode } from '../../shared/protocol.js';
import { AppError } from '../errors.js';
import { AsyncMutex } from './mutex.js';

export interface Member {
  userId: string;
  username: string;
}

export interface ChessGameState {
  id: string;
  status: 'waiting' | 'active' | 'finished';
  players: Partial<Record<ChessColor, Member>>;
  turn: ChessColor;
}

export interface PokerSeat {
  kind: 'human' | 'bot';
  userId?: string;
  name: string;
}

export interface PokerTableState {
  seats: (PokerSeat | null)[];
  handNumber: number;
}

export interface Room {
  id: string;
  game: GameType;
  mode: RoomMode;
  hostUserId: string;
  members: Member[];
  capacity: number;
  createdAt: number;
  version: number;
  listed: boolean;
  closed: boolean;
  lock: AsyncMutex;
  chess?: ChessGameState;
  poker?: PokerTableState;
}

export type RoomChange = { room: Room; affectedUserIds: string[] };

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly userRoom = new Map<string, string>();
  /** Serialises membership changes (create / join / leave) across all rooms (FR-015). */
  private readonly globalLock = new AsyncMutex();

  get(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  currentRoomId(userId: string): string | null {
    return this.userRoom.get(userId) ?? null;
  }

  list(): RoomListItem[] {
    return [...this.rooms.values()]
      .filter((r) => r.listed && !r.closed)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => {
        const players = occupiedCount(r);
        const host = r.members.find((m) => m.userId === r.hostUserId);
        return {
          id: r.id,
          game: r.game,
          hostUsername: host?.username ?? '',
          players,
          capacity: r.capacity,
          full: players >= r.capacity,
          status: roomStatus(r) === 'playing' ? 'playing' : 'waiting',
        };
      });
  }

  create(user: Member, game: GameType): Promise<Room> {
    return this.globalLock.run(() => {
      if (this.userRoom.has(user.userId)) throw new AppError('ALREADY_IN_ROOM');
      const room: Room = {
        id: randomUUID(),
        game,
        mode: 'online',
        hostUserId: user.userId,
        members: [{ ...user }],
        capacity: game === 'chess' ? CHESS_CAPACITY : POKER_CAPACITY,
        createdAt: Date.now() + this.rooms.size / 1000,
        version: 1,
        listed: true,
        closed: false,
        lock: new AsyncMutex(),
      };
      if (game === 'chess') {
        room.chess = { id: randomUUID(), status: 'waiting', players: { red: { ...user } }, turn: 'red' };
      } else {
        const seats: (PokerSeat | null)[] = Array.from({ length: POKER_CAPACITY }, () => null);
        seats[0] = { kind: 'human', userId: user.userId, name: user.username };
        room.poker = { seats, handNumber: 0 };
      }
      this.rooms.set(room.id, room);
      this.userRoom.set(user.userId, room.id);
      return room;
    });
  }

  join(user: Member, roomId: string): Promise<Room> {
    return this.globalLock.run(() =>
      this.withRoom(roomId, (room) => {
        if (room.members.some((m) => m.userId === user.userId)) return room;
        if (this.userRoom.has(user.userId)) throw new AppError('ALREADY_IN_ROOM');
        if (room.closed || !room.listed) throw new AppError('ROOM_NOT_FOUND');
        if (occupiedCount(room) >= room.capacity) throw new AppError('ROOM_FULL');
        if (room.chess && room.chess.status !== 'waiting') throw new AppError('ROOM_FULL');
        const freeSeat = room.poker ? room.poker.seats.findIndex((s) => s === null) : -1;
        if (room.poker && freeSeat < 0) throw new AppError('ROOM_FULL');
        room.members.push({ ...user });
        this.userRoom.set(user.userId, room.id);
        if (room.chess) {
          room.chess.players.black = { ...user };
          room.chess.status = 'active';
          room.chess.turn = 'red';
        }
        if (room.poker) {
          room.poker.seats[freeSeat] = { kind: 'human', userId: user.userId, name: user.username };
        }
        room.version += 1;
        return room;
      }),
    );
  }

  /** Removes the user from their room. Returns the room and the users who should receive an update. */
  leave(userId: string, roomId: string): Promise<RoomChange> {
    return this.globalLock.run(() =>
      this.withRoom(roomId, (room) => {
        if (!room.members.some((m) => m.userId === userId)) throw new AppError('NOT_IN_ROOM');
        room.members = room.members.filter((m) => m.userId !== userId);
        if (this.userRoom.get(userId) === room.id) this.userRoom.delete(userId);
        if (room.chess && room.chess.status === 'active') {
          // Leaving an active chess game counts as resigning (FR-092); scoring is added with the chess engine.
          room.chess.status = 'finished';
          room.closed = true;
        }
        if (room.poker) {
          room.poker.seats = room.poker.seats.map((s) => (s?.kind === 'human' && s.userId === userId ? null : s));
        }
        if (room.hostUserId === userId && room.members[0]) room.hostUserId = room.members[0].userId;
        if (room.members.length === 0) {
          room.closed = true;
          this.rooms.delete(room.id);
        }
        room.version += 1;
        return { room, affectedUserIds: room.members.map((m) => m.userId) };
      }),
    );
  }

  private withRoom<T>(roomId: string, fn: (room: Room) => T): Promise<T> {
    const room = this.rooms.get(roomId);
    if (!room) throw new AppError('ROOM_NOT_FOUND');
    return room.lock.run(() => fn(room));
  }
}

export function occupiedCount(room: Room): number {
  if (room.poker) return room.poker.seats.filter((s) => s !== null).length;
  return room.members.length;
}

export function roomStatus(room: Room): 'waiting' | 'playing' | 'closed' {
  if (room.closed) return 'closed';
  if (room.chess) return room.chess.status === 'waiting' ? 'waiting' : 'playing';
  return 'waiting';
}
