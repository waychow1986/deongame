import type { ApiError, GameType, RoomListItem, RoomSnapshot, UserDto } from '../shared/protocol.js';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (data as ApiError | null)?.error;
    if (res.status === 401 && err?.code === 'UNAUTHENTICATED' && !location.pathname.startsWith('/login')) {
      location.assign('/login');
    }
    throw new ApiRequestError(res.status, err?.code ?? 'INTERNAL_ERROR', err?.message ?? '网络错误，请重试');
  }
  return data as T;
}

export const api = {
  register: (username: string, password: string) =>
    request<{ user: UserDto }>('POST', '/api/auth/register', { username, password }),
  login: (username: string, password: string) =>
    request<{ user: UserDto }>('POST', '/api/auth/login', { username, password }),
  me: () => request<{ user: UserDto }>('GET', '/api/me'),
  listRooms: () => request<{ rooms: RoomListItem[] }>('GET', '/api/rooms'),
  createRoom: (game: GameType) => request<{ room: RoomSnapshot }>('POST', '/api/rooms', { game }),
  createAiGame: () => request<{ room: RoomSnapshot }>('POST', '/api/chess/ai-games', {}),
  addPokerBot: (id: string) => request<{ room: RoomSnapshot }>('POST', `/api/rooms/${encodeURIComponent(id)}/poker/bots`, {}),
  joinRoom: (id: string) => request<{ room: RoomSnapshot }>('POST', `/api/rooms/${encodeURIComponent(id)}/join`),
  leaveRoom: (id: string) => request<object>('POST', `/api/rooms/${encodeURIComponent(id)}/leave`),
  chessMove: (id: string, from: string, to: string) =>
    request<{ room: RoomSnapshot }>('POST', `/api/rooms/${encodeURIComponent(id)}/chess/move`, { from, to }),
  chessResign: (id: string) => request<{ room: RoomSnapshot }>('POST', `/api/rooms/${encodeURIComponent(id)}/chess/resign`),
  chessDrawOffer: (id: string) =>
    request<{ room: RoomSnapshot }>('POST', `/api/rooms/${encodeURIComponent(id)}/chess/draw-offer`),
  chessDrawResponse: (id: string, accept: boolean) =>
    request<{ room: RoomSnapshot }>('POST', `/api/rooms/${encodeURIComponent(id)}/chess/draw-response`, { accept }),
  pokerStart: (id: string) => request<{ room: RoomSnapshot }>('POST', `/api/rooms/${encodeURIComponent(id)}/poker/start`),
  pokerAction: (id: string, type: 'fold' | 'check' | 'call' | 'bet' | 'raise', amount?: number) =>
    request<{ room: RoomSnapshot }>(
      'POST',
      `/api/rooms/${encodeURIComponent(id)}/poker/action`,
      amount === undefined ? { type } : { type, amount },
    ),
  roomState: (id: string) => request<{ room: RoomSnapshot }>('GET', `/api/rooms/${encodeURIComponent(id)}/state`),
};

export function errorMessage(err: unknown): string {
  return err instanceof ApiRequestError ? err.message : '网络错误，请重试';
}
