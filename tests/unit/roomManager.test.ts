import { describe, expect, it } from 'vitest';
import { RoomManager } from '../../src/server/rooms/roomManager.js';
import { viewFor } from '../../src/server/rooms/view.js';

const alice = { userId: 'a', username: 'alice' };
const bob = { userId: 'b', username: 'bob' };
const carol = { userId: 'c', username: 'carol' };

describe('RoomManager', () => {
  it('lists a new chess room as joinable with one of two players', async () => {
    const rm = new RoomManager();
    const room = await rm.create(alice, 'chess');
    expect(rm.list()).toEqual([
      { id: room.id, game: 'chess', hostUsername: 'alice', players: 1, capacity: 2, full: false, status: 'waiting' },
    ]);
    expect(rm.currentRoomId('a')).toBe(room.id);
  });

  it('starts the chess game when the second player joins and rejects a third', async () => {
    const rm = new RoomManager();
    const room = await rm.create(alice, 'chess');
    await rm.join(bob, room.id);
    expect(rm.list()[0]).toMatchObject({ players: 2, full: true, status: 'playing' });
    expect(viewFor(room, 'a').chess?.yourColor).toBe('red');
    expect(viewFor(room, 'b').chess?.yourColor).toBe('black');
    await expect(rm.join(carol, room.id)).rejects.toMatchObject({ code: 'ROOM_FULL' });
  });

  it('admits exactly one of two concurrent joiners for the last seat', async () => {
    const rm = new RoomManager();
    const room = await rm.create(alice, 'chess');
    const results = await Promise.allSettled([rm.join(bob, room.id), rm.join(carol, room.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('keeps a user in at most one room', async () => {
    const rm = new RoomManager();
    const r1 = await rm.create(alice, 'poker');
    await expect(rm.create(alice, 'chess')).rejects.toMatchObject({ code: 'ALREADY_IN_ROOM' });
    const r2 = await rm.create(bob, 'poker');
    await expect(rm.join(alice, r2.id)).rejects.toMatchObject({ code: 'ALREADY_IN_ROOM' });
    expect((await rm.join(alice, r1.id)).id).toBe(r1.id);
  });

  it('transfers host to the earliest remaining member and closes the room when empty', async () => {
    const rm = new RoomManager();
    const room = await rm.create(alice, 'poker');
    await rm.join(bob, room.id);
    await rm.join(carol, room.id);
    await rm.leave('a', room.id);
    expect(room.hostUserId).toBe('b');
    expect(rm.list()[0]).toMatchObject({ hostUsername: 'bob', players: 2 });
    await rm.leave('b', room.id);
    await rm.leave('c', room.id);
    expect(rm.list()).toEqual([]);
    expect(rm.get(room.id)).toBeUndefined();
    expect(rm.currentRoomId('c')).toBeNull();
  });

  it('closes an active chess game when a player leaves and removes it from the lobby', async () => {
    const rm = new RoomManager();
    const room = await rm.create(alice, 'chess');
    await rm.join(bob, room.id);
    const { affectedUserIds } = await rm.leave('b', room.id);
    expect(affectedUserIds).toEqual(['a']);
    expect(viewFor(room, 'a').status).toBe('closed');
    expect(rm.list()).toEqual([]);
    await expect(rm.leave('b', room.id)).rejects.toMatchObject({ code: 'NOT_IN_ROOM' });
  });
});
