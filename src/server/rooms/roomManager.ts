import { randomUUID } from 'node:crypto';
import { CHESS_CAPACITY, POKER_CAPACITY } from '../../shared/constants.js';
import type { ChessColor, ChessOutcome, ChessReason, GameType, RoomListItem, RoomMode } from '../../shared/protocol.js';
import { cryptoRng, type Rng } from '../../shared/rng.js';
import {
  applyAction,
  forceFold,
  isHandOver,
  netResults,
  startHand,
  type HandState,
  type PlayerAction,
} from '../../shared/poker/index.js';
import { chooseBotAction, chooseChessMove } from '../../shared/ai/index.js';
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
  /** Current chip balances of the given users (default: 1000 each). */
  loadChips?: (userIds: string[]) => Promise<Map<string, number>>;
  /** Called inside the room lock to persist net chip changes of one hand (TD-011). */
  onPokerSettled?: (room: Room, handId: string, deltas: { userId: string; delta: number }[]) => Promise<void>;
  /** Called after the server changed a poker room on its own (automatic next hand). */
  onPokerUpdate?: (room: Room) => void;
  pokerNextHandDelayMs?: number;
  /** Called after a computer opponent / player changed a room on its own (AI move, bot action). */
  onRoomUpdate?: (room: Room) => void;
  /** Delay before the chess computer opponent moves (default 600 ms). */
  aiMoveDelayMs?: number;
  /** Delay before a poker computer player acts (default 800 ms). */
  pokerBotDelayMs?: number;
  /** Reports a failure of work the server started on its own (e.g. the automatic next hand). */
  onBackgroundError?: (err: unknown, info: { roomId: string; task: BackgroundTask }) => void;
}

export type BackgroundTask = 'poker_next_hand' | 'chess_ai_move' | 'poker_bot_action';

/** Display name of the chess computer opponent. */
export const COMPUTER_NAME = '电脑';


export interface PokerSeat {
  kind: 'human' | 'bot';
  userId?: string;
  name: string;
  /** Joined while a hand was running; takes part from the next hand (FR-054). */
  waitingNextHand?: boolean;
  /** Chip balance of a computer player; lives only in this room (FR-073). */
  chips?: number;
}

export interface PokerTableState {
  seats: (PokerSeat | null)[];
  handNumber: number;
  dealerSeat: number | null;
  hand: HandState | null;
  /** Who sat in each seat when the current hand started. */
  handPlayers: Record<number, PokerSeat>;
  /** Last known chip balance per human user (already including settled hands). */
  balances: Record<string, number>;
  /** Users whose result for the current hand is already settled (left mid-hand or hand over). */
  settledUserIds: string[];
  nextHandPending: boolean;
  /** Number of computer players added so far; names them "电脑 N". */
  botCounter: number;
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
  private readonly loadChips: (userIds: string[]) => Promise<Map<string, number>>;
  private readonly onPokerSettled?: RoomManagerOptions['onPokerSettled'];
  private readonly onPokerUpdate?: (room: Room) => void;
  private readonly pokerNextHandDelayMs: number;
  private readonly onRoomUpdate?: (room: Room) => void;
  private readonly aiMoveDelayMs: number;
  private readonly pokerBotDelayMs: number;
  private readonly onBackgroundError: NonNullable<RoomManagerOptions['onBackgroundError']>;

  constructor(opts: RoomManagerOptions = {}) {
    this.onBackgroundError = opts.onBackgroundError ?? (() => undefined);
    this.rng = opts.rng ?? cryptoRng;
    this.onChessFinished = opts.onChessFinished;
    this.loadChips = opts.loadChips ?? (async (ids) => new Map(ids.map((id) => [id, POKER_DEFAULT_CHIPS])));
    this.onPokerSettled = opts.onPokerSettled;
    this.onPokerUpdate = opts.onPokerUpdate;
    this.pokerNextHandDelayMs = opts.pokerNextHandDelayMs ?? 4000;
    this.onRoomUpdate = opts.onRoomUpdate;
    this.aiMoveDelayMs = opts.aiMoveDelayMs ?? 600;
    this.pokerBotDelayMs = opts.pokerBotDelayMs ?? 800;
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
    return this.globalLock.run(async () => {
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
        room.poker = {
          seats,
          handNumber: 0,
          dealerSeat: null,
          hand: null,
          handPlayers: {},
          balances: {},
          settledUserIds: [],
          nextHandPending: false,
          botCounter: 0,
        };
        await this.refreshBalances(room.poker, [user.userId]);
      }
      this.rooms.set(room.id, room);
      this.userRoom.set(user.userId, room.id);
      return room;
    });
  }

  /** Starts a chess game against the computer: unlisted, the user plays red and moves first (FR-064). */
  createAiGame(user: Member): Promise<Room> {
    return this.globalLock.run(() => {
      if (this.userRoom.has(user.userId)) throw new AppError('ALREADY_IN_ROOM');
      const room: Room = {
        id: randomUUID(),
        game: 'chess',
        mode: 'ai',
        hostUserId: user.userId,
        members: [{ ...user }],
        capacity: CHESS_CAPACITY,
        createdAt: Date.now() + this.rooms.size / 1000,
        version: 1,
        listed: false,
        closed: false,
        lock: new AsyncMutex(),
        chess: {
          id: randomUUID(),
          status: 'active',
          // The computer plays black and has no user entry, so only the user's result is recorded.
          players: { red: { ...user } },
          turn: 'red',
          board: createBoard(this.rng),
          captured: [],
          lastMove: null,
          drawOffer: null,
          result: null,
        },
      };
      this.rooms.set(room.id, room);
      this.userRoom.set(user.userId, room.id);
      return room;
    });
  }

  join(user: Member, roomId: string): Promise<Room> {
    return this.globalLock.run(() =>
      this.withRoom(roomId, async (room) => {
        if (room.members.some((m) => m.userId === user.userId)) return room;
        if (this.userRoom.has(user.userId)) throw new AppError('ALREADY_IN_ROOM');
        if (room.closed || !room.listed) throw new AppError('ROOM_NOT_FOUND');
        if (occupiedCount(room) >= room.capacity) throw new AppError('ROOM_FULL');
        if (room.chess && room.chess.status !== 'waiting') throw new AppError('ROOM_FULL');
        const freeSeat = room.poker ? pickFreeSeat(room.poker) : -1;
        if (room.poker && freeSeat < 0) throw new AppError('ROOM_FULL');
        if (room.poker) await this.refreshBalances(room.poker, [user.userId]);
        room.members.push({ ...user });
        this.userRoom.set(user.userId, room.id);
        if (room.chess) {
          room.chess.players.black = { ...user };
          room.chess.status = 'active';
          room.chess.turn = 'red';
        }
        if (room.poker) {
          room.poker.seats[freeSeat] = {
            kind: 'human',
            userId: user.userId,
            name: user.username,
            ...(handActive(room.poker) ? { waitingNextHand: true } : {}),
          };
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
        if (room.poker) await this.pokerLeave(room, userId);
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
      else {
        room.version += 1;
        if (room.mode === 'ai') this.scheduleAiMove(room);
      }
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
      // The computer opponent always accepts a draw (FR-064).
      if (room.mode === 'ai') return this.finishChess(room, 'draw', 'draw_agreed');
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

  /** The host adds a computer player to a free seat between hands (spec AC-17, FR-070–072). */
  addPokerBot(userId: string, roomId: string): Promise<Room> {
    return this.globalLock.run(() =>
      this.withRoom(roomId, (room) => {
        const poker = requirePokerMember(room, userId);
        if (room.hostUserId !== userId) throw new AppError('NOT_HOST');
        if (handActive(poker) || poker.nextHandPending) throw new AppError('HAND_IN_PROGRESS');
        const seat = pickFreeSeat(poker);
        if (seat < 0) throw new AppError('ROOM_FULL');
        poker.botCounter += 1;
        poker.seats[seat] = { kind: 'bot', name: `${COMPUTER_NAME} ${poker.botCounter}`, chips: POKER_DEFAULT_CHIPS };
        room.version += 1;
        return room;
      }),
    );
  }

  pokerStart(userId: string, roomId: string): Promise<Room> {
    return this.withRoom(roomId, async (room) => {
      const poker = requirePokerMember(room, userId);
      if (room.hostUserId !== userId) throw new AppError('NOT_HOST');
      if (handActive(poker) || poker.nextHandPending) throw new AppError('HAND_IN_PROGRESS');
      if (seatedIndexes(poker).length < 2) throw new AppError('NOT_ENOUGH_PLAYERS');
      const hostSeat = poker.seats.findIndex((s) => s?.kind === 'human' && s.userId === room.hostUserId);
      await this.startPokerHand(room, poker.dealerSeat === null ? hostSeat : null);
      this.scheduleBot(room);
      return room;
    });
  }

  pokerAction(userId: string, roomId: string, action: PlayerAction): Promise<Room> {
    return this.withRoom(roomId, async (room) => {
      const poker = requirePokerMember(room, userId);
      const hand = poker.hand;
      if (!hand || isHandOver(hand)) throw new AppError('GAME_NOT_ACTIVE');
      const seat = handSeatOf(poker, userId);
      if (seat === null) throw new AppError('NOT_YOUR_TURN');
      const res = applyAction(hand, seat, action);
      if (!res.ok) throw res.code === 'NOT_YOUR_TURN' ? new AppError('NOT_YOUR_TURN') : new AppError(res.code, res.message);
      if (isHandOver(hand)) await this.finishPokerHand(room);
      room.version += 1;
      this.scheduleBot(room);
      return room;
    });
  }

  private async pokerLeave(room: Room, userId: string): Promise<void> {
    const poker = room.poker as PokerTableState;
    const seatIdx = poker.seats.findIndex((s) => s?.kind === 'human' && s.userId === userId);
    if (seatIdx >= 0) poker.seats[seatIdx] = null;
    const hand = poker.hand;
    const handSeat = hand && !isHandOver(hand) ? handSeatOf(poker, userId, seatIdx) : null;
    if (hand && handSeat !== null) {
      // Leaving mid-hand folds the player and settles what they already put in (FR-093).
      forceFold(hand, handSeat);
      const committed = hand.players.find((p) => p.seat === handSeat)?.committed ?? 0;
      await this.settlePoker(room, hand.id, [{ userId, delta: -committed }]);
      if (isHandOver(hand)) await this.finishPokerHand(room);
      else this.scheduleBot(room);
    }
  }

  private async startPokerHand(room: Room, dealerSeat: number | null): Promise<void> {
    const poker = room.poker as PokerTableState;
    const seats = seatedIndexes(poker);
    const dealer = dealerSeat ?? nextSeatAfter(seats, poker.dealerSeat ?? -1);
    await this.refreshBalances(
      poker,
      seats.flatMap((i) => (poker.seats[i]?.kind === 'human' ? [poker.seats[i]?.userId as string] : [])),
    );
    poker.handPlayers = {};
    for (const i of seats) {
      const s = poker.seats[i] as PokerSeat;
      delete s.waitingNextHand;
      poker.handPlayers[i] = { ...s };
    }
    poker.settledUserIds = [];
    poker.dealerSeat = dealer;
    poker.handNumber += 1;
    poker.hand = startHand({ id: randomUUID(), seats, dealerSeat: dealer, rng: this.rng });
  }

  /** Settles everybody not yet settled, then schedules the next hand (FR-060, FR-066). */
  private async finishPokerHand(room: Room): Promise<void> {
    const poker = room.poker as PokerTableState;
    const hand = poker.hand as HandState;
    const nets = netResults(hand);
    // Computer players keep their chips in the room only (FR-073).
    for (const { seat, net } of nets) {
      const live = poker.seats[seat];
      if (live?.kind === 'bot' && poker.handPlayers[seat]?.kind === 'bot' && poker.handPlayers[seat]?.name === live.name) {
        live.chips = (live.chips ?? POKER_DEFAULT_CHIPS) + net;
      }
    }
    const deltas = nets.flatMap(({ seat, net }) => {
      const p = poker.handPlayers[seat];
      if (p?.kind !== 'human' || !p.userId || poker.settledUserIds.includes(p.userId)) return [];
      return [{ userId: p.userId, delta: net }];
    });
    await this.settlePoker(room, hand.id, deltas);
    this.scheduleNextHand(room, hand.id);
  }

  private async settlePoker(room: Room, handId: string, deltas: { userId: string; delta: number }[]): Promise<void> {
    const poker = room.poker as PokerTableState;
    for (const d of deltas) {
      poker.settledUserIds.push(d.userId);
      poker.balances[d.userId] = (poker.balances[d.userId] ?? POKER_DEFAULT_CHIPS) + d.delta;
    }
    if (deltas.length > 0 && this.onPokerSettled) await this.onPokerSettled(room, handId, deltas);
  }

  private scheduleNextHand(room: Room, handId: string): void {
    const poker = room.poker as PokerTableState;
    poker.nextHandPending = true;
    const timer = setTimeout(() => {
      room.lock
        .run(async () => {
          if (poker.hand?.id !== handId || !poker.nextHandPending) return;
          poker.nextHandPending = false;
          if (room.closed || seatedIndexes(poker).length < 2) return;
          await this.startPokerHand(room, null);
          room.version += 1;
          this.onPokerUpdate?.(room);
          this.scheduleBot(room);
        })
        // startPokerHand reads balances before changing any state, so on failure the table stays at the
        // finished hand with nextHandPending cleared and the host can start the next hand manually.
        .catch((err: unknown) => {
          try {
            this.onBackgroundError(err, { roomId: room.id, task: 'poker_next_hand' });
          } catch {
            // never let error reporting escape the timer
          }
        });
    }, this.pokerNextHandDelayMs);
    timer.unref();
  }

  /** Lets the chess computer opponent (black) reply after a delay, inside the room lock. */
  private scheduleAiMove(room: Room): void {
    const chess = room.chess as ChessGameState;
    const gameId = chess.id;
    this.runLater(room, 'chess_ai_move', this.aiMoveDelayMs, async () => {
      if (room.closed || chess.id !== gameId || chess.status !== 'active' || chess.turn !== 'black') return;
      const choice = chooseChessMove({ board: chess.board, side: 'black', captured: chess.captured, rng: this.rng });
      if (!choice) return;
      const res = applyMove(chess.board, 'black', choice.from, choice.to);
      if (!res.ok) throw new Error(`computer chose an illegal move: ${res.code}`);
      chess.board = res.board;
      chess.lastMove = res.move;
      if (res.move.captured) chess.captured.push(res.move.captured);
      chess.turn = 'red';
      if (res.end) await this.finishChess(room, res.end.outcome, res.end.reason);
      else room.version += 1;
      this.onRoomUpdate?.(room);
    });
  }

  /** If a computer player is to act in the running hand, lets it act after a delay. */
  private scheduleBot(room: Room): void {
    const poker = room.poker as PokerTableState;
    const hand = poker.hand;
    if (!hand || isHandOver(hand) || hand.toAct === null) return;
    const seat = hand.toAct;
    const bot = poker.seats[seat];
    if (bot?.kind !== 'bot' || poker.handPlayers[seat]?.kind !== 'bot') return;
    this.runLater(room, 'poker_bot_action', this.pokerBotDelayMs, async () => {
      if (room.closed || poker.hand !== hand || isHandOver(hand) || hand.toAct !== seat || poker.seats[seat] !== bot) return;
      const res = applyAction(hand, seat, chooseBotAction(hand, seat));
      if (!res.ok) throw new Error(`computer player chose an illegal action: ${res.code}`);
      if (isHandOver(hand)) await this.finishPokerHand(room);
      room.version += 1;
      this.onRoomUpdate?.(room);
      this.scheduleBot(room);
    });
  }

  /** Runs server-initiated work inside the room lock after a delay; failures go to onBackgroundError. */
  private runLater(room: Room, task: BackgroundTask, delayMs: number, fn: () => Promise<void>): void {
    const timer = setTimeout(() => {
      room.lock.run(fn).catch((err: unknown) => {
        try {
          this.onBackgroundError(err, { roomId: room.id, task });
        } catch {
          // never let error reporting escape the timer
        }
      });
    }, delayMs);
    timer.unref();
  }

  private async refreshBalances(poker: PokerTableState, userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    const chips = await this.loadChips(userIds);
    for (const id of userIds) poker.balances[id] = chips.get(id) ?? poker.balances[id] ?? POKER_DEFAULT_CHIPS;
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

export const POKER_DEFAULT_CHIPS = 1000;

export function handActive(poker: PokerTableState): boolean {
  return poker.hand !== null && !isHandOver(poker.hand);
}

/** The hand seat of a user, only while that user still occupies the seat they started the hand in. */
export function handSeatOf(poker: PokerTableState, userId: string, seatIdx?: number): number | null {
  const seat = seatIdx ?? poker.seats.findIndex((s) => s?.kind === 'human' && s.userId === userId);
  if (seat < 0 || !poker.hand) return null;
  const p = poker.handPlayers[seat];
  return p?.userId === userId && poker.hand.players.some((x) => x.seat === seat) ? seat : null;
}

function seatedIndexes(poker: PokerTableState): number[] {
  return poker.seats.flatMap((s, i) => (s ? [i] : []));
}

function nextSeatAfter(seats: number[], after: number): number {
  return seats.find((s) => s > after) ?? (seats[0] as number);
}

/** Prefers seats that are not part of the running hand so a newcomer never inherits a hand seat. */
function pickFreeSeat(poker: PokerTableState): number {
  const free = poker.seats.flatMap((s, i) => (s === null ? [i] : []));
  if (handActive(poker)) {
    const fresh = free.find((i) => !(i in poker.handPlayers));
    if (fresh !== undefined) return fresh;
  }
  return free[0] ?? -1;
}

function requirePokerMember(room: Room, userId: string): PokerTableState {
  if (!room.members.some((m) => m.userId === userId)) throw new AppError('NOT_IN_ROOM');
  if (!room.poker) throw new AppError('GAME_NOT_ACTIVE');
  return room.poker;
}

export function occupiedCount(room: Room): number {
  if (room.poker) return room.poker.seats.filter((s) => s !== null).length;
  return room.members.length;
}

export function roomStatus(room: Room): 'waiting' | 'playing' | 'closed' {
  if (room.closed) return 'closed';
  if (room.chess) return room.chess.status === 'waiting' ? 'waiting' : 'playing';
  if (room.poker && handActive(room.poker)) return 'playing';
  return 'waiting';
}
