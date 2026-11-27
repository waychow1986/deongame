import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RoomListItem, RoomSnapshot } from '../../src/shared/protocol.js';
import { Client, startTestServer, uniqueName, waitForEvent, type TestServer } from '../support/server.js';

let ts: TestServer;

beforeAll(async () => {
  ts = await startTestServer();
});

afterAll(async () => {
  await ts?.stop();
});

type ErrBody = { error: { code: string; message: string } };
type RoomBody = { room: RoomSnapshot };

async function user(label: string): Promise<Client & { name: string }> {
  const c = new Client(ts.baseUrl) as Client & { name: string };
  c.name = uniqueName(label);
  await c.register(c.name);
  return c;
}

async function listed(c: Client, roomId: string): Promise<RoomListItem | undefined> {
  const res = await c.get<{ rooms: RoomListItem[] }>('/api/rooms');
  return res.body.rooms.find((r) => r.id === roomId);
}

describe('rooms (AC-4, AC-5)', () => {
  it('creates a chess room that other users see in the lobby', async () => {
    const alice = await user('alice');
    const bob = await user('bob');
    const created = await alice.post<RoomBody>('/api/rooms', { game: 'chess' });
    expect(created.status).toBe(201);
    expect(created.body.room).toMatchObject({ game: 'chess', capacity: 2, status: 'waiting' });
    const roomId = created.body.room.roomId;
    expect(await listed(bob, roomId)).toEqual({
      id: roomId,
      game: 'chess',
      hostUsername: alice.name,
      players: 1,
      capacity: 2,
      full: false,
      status: 'waiting',
    });
    expect((await alice.get<{ user: { currentRoomId: string } }>('/api/me')).body.user.currentRoomId).toBe(roomId);
    await alice.post(`/api/rooms/${roomId}/leave`);
  });

  it('creates a poker room with 9 seats', async () => {
    const alice = await user('pk');
    const created = await alice.post<RoomBody>('/api/rooms', { game: 'poker' });
    expect(created.status).toBe(201);
    expect(await listed(alice, created.body.room.roomId)).toMatchObject({ game: 'poker', players: 1, capacity: 9, full: false });
    await alice.post(`/api/rooms/${created.body.room.roomId}/leave`);
  });

  it('rejects an unknown game type', async () => {
    const alice = await user('bad');
    const res = await alice.post<ErrBody>('/api/rooms', { game: 'go' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('joins a chess room, pushes the update to the host and marks the room full', async () => {
    const alice = await user('host');
    const bob = await user('guest');
    const carol = await user('late');
    const { roomId } = (await alice.post<RoomBody>('/api/rooms', { game: 'chess' })).body.room;

    const socket = alice.socket();
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve());
      socket.on('connect_error', reject);
    });
    const pushed = waitForEvent<RoomSnapshot>(socket, 'room:state', (s) => s.roomId === roomId && s.members.length === 2);

    const joined = await bob.post<RoomBody>(`/api/rooms/${roomId}/join`);
    expect(joined.status).toBe(200);
    expect(joined.body.room.chess).toMatchObject({ status: 'active', yourColor: 'black', turn: 'red' });
    const snap = await pushed;
    expect(snap.chess).toMatchObject({ yourColor: 'red', status: 'active' });
    expect(snap.members.map((m) => m.username)).toEqual([alice.name, bob.name]);
    socket.close();

    expect(await listed(carol, roomId)).toMatchObject({ players: 2, full: true, status: 'playing' });
    const full = await carol.post<ErrBody>(`/api/rooms/${roomId}/join`);
    expect(full.status).toBe(409);
    expect(full.body.error).toEqual({ code: 'ROOM_FULL', message: '房间已满' });

    const again = await bob.post<RoomBody>(`/api/rooms/${roomId}/join`);
    expect(again.status).toBe(200);

    await bob.post(`/api/rooms/${roomId}/leave`);
    await alice.post(`/api/rooms/${roomId}/leave`);
  });

  it('lets exactly one of two simultaneous joiners take the last chess seat', async () => {
    const host = await user('h');
    const [x, y] = await Promise.all([user('x'), user('y')]);
    const { roomId } = (await host.post<RoomBody>('/api/rooms', { game: 'chess' })).body.room;
    const results = await Promise.all([x.post(`/api/rooms/${roomId}/join`), y.post(`/api/rooms/${roomId}/join`)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await host.get<RoomBody>(`/api/rooms/${roomId}/state`)).body.room.members).toHaveLength(2);
    for (const c of [host, x, y]) await c.post(`/api/rooms/${roomId}/leave`);
  });

  it('keeps a user in only one room at a time', async () => {
    const alice = await user('one');
    const bob = await user('two');
    const a = (await alice.post<RoomBody>('/api/rooms', { game: 'poker' })).body.room.roomId;
    const b = (await bob.post<RoomBody>('/api/rooms', { game: 'poker' })).body.room.roomId;
    const create = await alice.post<ErrBody>('/api/rooms', { game: 'chess' });
    expect(create.status).toBe(409);
    expect(create.body.error.code).toBe('ALREADY_IN_ROOM');
    const join = await alice.post<ErrBody>(`/api/rooms/${b}/join`);
    expect(join.status).toBe(409);
    expect(join.body.error.code).toBe('ALREADY_IN_ROOM');
    await alice.post(`/api/rooms/${a}/leave`);
    expect((await alice.post(`/api/rooms/${b}/join`)).status).toBe(200);
    await alice.post(`/api/rooms/${b}/leave`);
    await bob.post(`/api/rooms/${b}/leave`);
  });

  it('transfers host on leave and closes the room when the last person leaves', async () => {
    const alice = await user('ha');
    const bob = await user('hb');
    const { roomId } = (await alice.post<RoomBody>('/api/rooms', { game: 'poker' })).body.room;
    await bob.post(`/api/rooms/${roomId}/join`);
    expect((await alice.post(`/api/rooms/${roomId}/leave`)).status).toBe(200);
    expect(await listed(bob, roomId)).toMatchObject({ hostUsername: bob.name, players: 1 });
    expect((await alice.get<{ user: { currentRoomId: null } }>('/api/me')).body.user.currentRoomId).toBeNull();
    await bob.post(`/api/rooms/${roomId}/leave`);
    expect(await listed(bob, roomId)).toBeUndefined();
    const gone = await bob.post<ErrBody>(`/api/rooms/${roomId}/join`);
    expect(gone.status).toBe(404);
    expect(gone.body.error.code).toBe('ROOM_NOT_FOUND');
  });

  it('restricts room state to members and validates room ids', async () => {
    const alice = await user('sa');
    const bob = await user('sb');
    const { roomId } = (await alice.post<RoomBody>('/api/rooms', { game: 'chess' })).body.room;
    expect((await alice.get(`/api/rooms/${roomId}/state`)).status).toBe(200);
    const notMember = await bob.get<ErrBody>(`/api/rooms/${roomId}/state`);
    expect(notMember.status).toBe(403);
    expect(notMember.body.error.code).toBe('NOT_IN_ROOM');
    expect((await bob.post<ErrBody>(`/api/rooms/${roomId}/leave`)).status).toBe(403);
    expect((await bob.post<ErrBody>('/api/rooms/not-a-uuid/join')).status).toBe(404);
    await alice.post(`/api/rooms/${roomId}/leave`);
  });

  it('removes a chess room from the lobby when a player leaves an active game', async () => {
    const alice = await user('ca');
    const bob = await user('cb');
    const { roomId } = (await alice.post<RoomBody>('/api/rooms', { game: 'chess' })).body.room;
    await bob.post(`/api/rooms/${roomId}/join`);
    await bob.post(`/api/rooms/${roomId}/leave`);
    expect(await listed(alice, roomId)).toBeUndefined();
    const state = await alice.get<RoomBody>(`/api/rooms/${roomId}/state`);
    expect(state.body.room).toMatchObject({ status: 'closed' });
    expect(state.body.room.chess?.status).toBe('finished');
    await alice.post(`/api/rooms/${roomId}/leave`);
    expect((await alice.get<{ user: { currentRoomId: null } }>('/api/me')).body.user.currentRoomId).toBeNull();
  });
});
