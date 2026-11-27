import { randomUUID } from 'node:crypto';
import { CHESS_CAPACITY, POKER_CAPACITY } from '../../shared/constants.js';
import type { ChessColor, ChessOutcome, ChessReason, GameType, RoomListItem, RoomMode } from '../../shared/protocol.js';
import { cryptoRng, type Rng } from '../../shared/rng.js';
import { applyMove, createBoard, type Board, type MoveRecord } from '../../shared/xiangqi/index.js';
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
  board: Board;
  captured: NonNullable<MoveRecord['captured']>[];
  lastMove: MoveRecord | null;
  drawOffer: { by: ChessColor } | null;
  result: ChessResultState | null;
}

export interface ChessResultState {
  outcome: ChessOutcome;
  reason: ChessReason;
  settled: boolean;
  ratingChanges: { userId: string; delta: number; rating: number }[];
}

export interface RoomManagerOptions {
  rng?: Rng;
  /** Called inside the room lock right after a chess game ends; persists the result (TD-010, TD-018). */
  onChessFinished?: (room: Room) => Promise<void>;
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
  private readonly rng: Rng;
  private readonly onChessFinished?: (room: Room) => Promise<void>;

  constructor(opts: RoomManagerOptions = {}) {
    this.rng = opts.rng ?? cryptoRng;
    this.onChessFinished = opts.onChessFinished;
  }

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
        room.chess = {
          id: randomUUID(),
          status: 'waiting',
          players: { red: { ...user } },
          turn: 'red',
          board: createBoard(this.rng),
          captured: [],
          lastMove: null,
          drawOffer: null,
          result: null,
        };
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
      this.withRoom(roomId, async (room) => {
        if (!room.members.some((m) => m.userId === userId)) throw new AppError('NOT_IN_ROOM');
        // Leaving an active chess game counts as resigning (FR-092).
        const leaverColor = room.chess?.status === 'active' ? colorOf(room.chess, userId) : null;
        room.members = room.members.filter((m) => m.userId !== userId);
        if (this.userRoom.get(userId) === room.id) this.userRoom.delete(userId);
        if (leaverColor) await this.finishChess(room, leaverColor === 'red' ? 'black_win' : 'red_win', 'resign');
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

  chessMove(userId: string, roomId: string, from: string, to: string): Promise<Room> {
    return this.withChess(userId, roomId, async (room, chess, color) => {
      if (chess.turn !== color) throw new AppError('NOT_YOUR_TURN');
      const res = applyMove(chess.board, color, from, to);
      if (!res.ok) throw new AppError(res.code);
      chess.board = res.board;
      chess.lastMove = res.move;
      if (res.move.captured) chess.captured.push(res.move.captured);
      if (chess.drawOffer && chess.drawOffer.by !== color) chess.drawOffer = null;
      chess.turn = color === 'red' ? 'black' : 'red';
      if (res.end) await this.finishChess(room, res.end.outcome, res.end.reason);
      else room.version += 1;
    });
  }

  chessResign(userId: string, roomId: string): Promise<Room> {
    return this.withChess(userId, roomId, async (room, _chess, color) => {
      await this.finishChess(room, color === 'red' ? 'black_win' : 'red_win', 'resign');
    });
  }

  chessDrawOffer(userId: string, roomId: string): Promise<Room> {
    return this.withChess(userId, roomId, (room, chess, color) => {
      if (chess.drawOffer) throw new AppError('DRAW_OFFER_PENDING');
      chess.drawOffer = { by: color };
      room.version += 1;
    });
  }

  chessDrawResponse(userId: string, roomId: string, accept: boolean): Promise<Room> {
    return this.withChess(userId, roomId, async (room, chess, color) => {
      if (!chess.drawOffer || chess.drawOffer.by === color) throw new AppError('NO_DRAW_OFFER');
      if (accept) {
        await this.finishChess(room, 'draw', 'draw_agreed');
      } else {
        chess.drawOffer = null;
        room.version += 1;
      }
    });
  }

  /** Ends the game, closes the room to the lobby and settles inside the room lock. */
  private async finishChess(room: Room, outcome: ChessOutcome, reason: ChessReason): Promise<void> {
    const chess = room.chess as ChessGameState;
    chess.status = 'finished';
    chess.drawOffer = null;
    chess.result = { outcome, reason, settled: false, ratingChanges: [] };
    room.closed = true;
    if (this.onChessFinished) await this.onChessFinished(room);
    room.version += 1;
  }

  private withChess(
    userId: string,
    roomId: string,
    fn: (room: Room, chess: ChessGameState, color: ChessColor) => void | Promise<void>,
  ): Promise<Room> {
    return this.withRoom(roomId, async (room) => {
      if (!room.members.some((m) => m.userId === userId)) throw new AppError('NOT_IN_ROOM');
      const chess = room.chess;
      if (!chess || chess.status !== 'active') throw new AppError('GAME_NOT_ACTIVE');
      const color = colorOf(chess, userId);
      if (!color) throw new AppError('NOT_IN_ROOM');
      await fn(room, chess, color);
      return room;
    });
  }

  private withRoom<T>(roomId: string, fn: (room: Room) => T | Promise<T>): Promise<T> {
    const room = this.rooms.get(roomId);
    if (!room) throw new AppError('ROOM_NOT_FOUND');
    return room.lock.run(() => fn(room));
  }
}

export function colorOf(chess: ChessGameState, userId: string): ChessColor | null {
  if (chess.players.red?.userId === userId) return 'red';
  if (chess.players.black?.userId === userId) return 'black';
  return null;
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
