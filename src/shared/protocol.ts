export type GameType = 'chess' | 'poker';
export type RoomMode = 'online' | 'ai';
export type ChessColor = 'red' | 'black';
export type ChessPieceType = 'king' | 'advisor' | 'elephant' | 'horse' | 'rook' | 'cannon' | 'pawn';
export type ChessOutcome = 'red_win' | 'black_win' | 'draw';
export type ChessReason = 'checkmate' | 'stalemate' | 'resign' | 'draw_agreed' | 'bare_kings';

export const ERROR_MESSAGES = {
  VALIDATION_FAILED: '请求参数不合法',
  UNAUTHENTICATED: '请先登录',
  INVALID_CREDENTIALS: '用户名或密码错误',
  NOT_IN_ROOM: '你不在这个房间中',
  NOT_HOST: '只有房主可以进行此操作',
  ROOM_NOT_FOUND: '房间不存在或已关闭',
  USERNAME_TAKEN: '用户名已被占用',
  ROOM_FULL: '房间已满',
  ALREADY_IN_ROOM: '你已在其他房间中，请先离开当前房间',
  UNSUPPORTED_MEDIA_TYPE: '请求格式不支持',
  INTERNAL_ERROR: '服务器内部错误',
  NOT_YOUR_TURN: '还没轮到你',
  ILLEGAL_MOVE: '走法不合规',
  GAME_NOT_ACTIVE: '对局未在进行中',
  DRAW_OFFER_PENDING: '已有待回应的提和',
  NO_DRAW_OFFER: '没有待回应的提和',
  ILLEGAL_ACTION: '行动不合规',
  HAND_IN_PROGRESS: '手牌进行中，暂不能进行此操作',
  NOT_ENOUGH_PLAYERS: '至少需要 2 名玩家才能开始',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export interface ApiError {
  error: { code: ErrorCode; message: string };
}

export interface UserDto {
  id: string;
  username: string;
  rating: number;
  chips: number;
  currentRoomId: string | null;
}

export interface RoomListItem {
  id: string;
  game: GameType;
  hostUsername: string;
  players: number;
  capacity: number;
  full: boolean;
  status: 'waiting' | 'playing';
}

export interface MemberDto {
  userId: string;
  username: string;
}

export interface ChessPlayerDto {
  userId?: string;
  username: string;
  computer?: boolean;
}

export interface ChessView {
  gameId: string;
  status: 'waiting' | 'active' | 'finished';
  players: { red: ChessPlayerDto | null; black: ChessPlayerDto | null };
  yourColor: ChessColor | null;
  turn: ChessColor;
  inCheck: boolean;
  /** Occupied squares only; covered pieces are always `hidden`, for every viewer. */
  board: ChessSquareView[];
  captured: { side: ChessColor; piece: ChessPieceType }[];
  lastMove: {
    from: string;
    to: string;
    side: ChessColor;
    revealed?: ChessPieceType;
    captured?: { side: ChessColor; piece: ChessPieceType };
  } | null;
  drawOffer: { by: ChessColor } | null;
  result: ChessResultView | null;
}

export interface ChessSquareView {
  pos: string;
  side: ChessColor;
  piece: ChessPieceType | 'hidden';
}

export interface ChessResultView {
  outcome: ChessOutcome;
  reason: ChessReason;
  settled: boolean;
  ratingChanges: { userId: string; delta: number; rating: number }[];
}

export type PokerStage = 'idle' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';
export type PokerActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise';
export type PokerLogType = PokerActionType | 'small_blind' | 'big_blind' | 'leave_fold';
export type PokerHandRank =
  | 'high_card'
  | 'one_pair'
  | 'two_pair'
  | 'three_of_a_kind'
  | 'straight'
  | 'flush'
  | 'full_house'
  | 'four_of_a_kind'
  | 'straight_flush'
  | 'royal_flush';

export interface PokerSeatView {
  seat: number;
  kind: 'human' | 'bot';
  userId?: string;
  name: string;
  chips: number;
  committedThisHand: number;
  committedThisRound: number;
  inHand: boolean;
  folded: boolean;
  atCap: boolean;
  waitingNextHand: boolean;
  isDealer: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  /** Only for the viewer's own seat or seats revealed at showdown. */
  holeCards?: string[];
}

export interface PokerLegalActions {
  fold: boolean;
  check: boolean;
  call: boolean;
  callAmount: number;
  bet: boolean;
  raise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
}

export interface PokerView {
  handId: string | null;
  handNumber: number;
  stage: PokerStage;
  blinds: { small: number; big: number };
  handCommitCap: number;
  board: string[];
  pot: number;
  currentBet: number;
  toActSeat: number | null;
  seats: PokerSeatView[];
  /** `amount` is what the action put in; `to` is the round total after a bet / raise. */
  actions: { seat: number; name: string; type: PokerLogType; amount: number; to?: number }[];
  showdown: { seat: number; holeCards: string[]; handRank: PokerHandRank; handLabel: string }[];
  winners: { seat: number; name: string; amount: number }[];
  you: { seat: number | null; legal: PokerLegalActions | null };
}

export interface RoomSnapshot {
  roomId: string;
  game: GameType;
  mode: RoomMode;
  version: number;
  hostUserId: string;
  members: MemberDto[];
  capacity: number;
  status: 'waiting' | 'playing' | 'closed';
  you: { userId: string };
  chess?: ChessView;
  poker?: PokerView;
}
