import { describe, expect, it } from 'vitest';
import type { RoomListItem } from '../../src/shared/protocol.js';
import { gameLabel, joinState, roomName, statusLabel } from '../../src/shared/ui/lobby.js';

function item(over: Partial<RoomListItem>): RoomListItem {
  return { id: 'r1', game: 'poker', hostUsername: 'alice', players: 1, capacity: 9, full: false, status: 'waiting', ...over };
}

describe('lobby room list rules (FR-015, FR-017)', () => {
  it('names the room after the current host and labels game and status', () => {
    expect(roomName(item({ hostUsername: '小明' }))).toBe('小明的房间');
    expect(gameLabel('chess')).toBe('中国象棋·盲棋');
    expect(gameLabel('poker')).toBe('德州扑克');
    expect(statusLabel('waiting')).toBe('等待中');
    expect(statusLabel('playing')).toBe('对局中');
  });

  it('lets a poker room in play with a free seat be joined (Q4)', () => {
    expect(joinState(item({ status: 'playing', players: 3, capacity: 6 }), false)).toEqual({ joinable: true });
  });

  it('greys out full rooms and chess rooms in play', () => {
    expect(joinState(item({ full: true, players: 9 }), false)).toEqual({ joinable: false, reason: '已满员' });
    expect(joinState(item({ game: 'chess', full: true, players: 2, capacity: 2, status: 'playing' }), false)).toEqual({
      joinable: false,
      reason: '已满员',
    });
    expect(joinState(item({ game: 'chess', capacity: 2, status: 'playing' }), false)).toEqual({ joinable: false, reason: '对局中' });
    expect(joinState(item({ game: 'chess', capacity: 2 }), false)).toEqual({ joinable: true });
  });

  it('blocks joining while the user has an unfinished game (FR-007)', () => {
    expect(joinState(item({}), true)).toEqual({ joinable: false, reason: '你有进行中的对局' });
    expect(joinState(item({ full: true }), true)).toEqual({ joinable: false, reason: '你有进行中的对局' });
  });
});
