export type GameType = 'chess' | 'poker';
export type RoomMode = 'online' | 'ai';
export type ChessColor = 'red' | 'black';

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
}

export interface PokerSeatView {
  seat: number;
  kind: 'human' | 'bot';
  userId?: string;
  name: string;
}

export interface PokerView {
  handId: string | null;
  handNumber: number;
  stage: 'idle';
  seats: PokerSeatView[];
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
