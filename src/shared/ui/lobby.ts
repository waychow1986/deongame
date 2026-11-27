import type { GameType, RoomListItem } from '../protocol.js';

export type JoinState = { joinable: true } | { joinable: false; reason: string };

export const ACTIVE_GAME_REASON = '你有进行中的对局';

export function gameLabel(game: GameType): string {
  return game === 'chess' ? '中国象棋·盲棋' : '德州扑克';
}

export function statusLabel(status: RoomListItem['status']): string {
  return status === 'playing' ? '对局中' : '等待中';
}

export function roomName(item: Pick<RoomListItem, 'hostUsername'>): string {
  return `${item.hostUsername}的房间`;
}

/** Whether the viewer may join a listed room (TD-020; poker rooms in play stay joinable while a seat is free). */
export function joinState(item: RoomListItem, hasActiveGame: boolean): JoinState {
  if (hasActiveGame) return { joinable: false, reason: ACTIVE_GAME_REASON };
  if (item.full) return { joinable: false, reason: '已满员' };
  if (item.game === 'chess' && item.status === 'playing') return { joinable: false, reason: '对局中' };
  return { joinable: true };
}
