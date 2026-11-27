import { describe, expect, it } from 'vitest';
import { RoomManager, type Room } from '../../src/server/rooms/roomManager.js';
import { viewFor } from '../../src/server/rooms/view.js';
import { legalActions } from '../../src/shared/poker/index.js';
import { seededRng } from '../../src/shared/rng.js';

const alice = { userId: 'a', username: 'alice' };
const bob = { userId: 'b', username: 'bob' };

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'none';
  } catch (err) {
    return (err as { code: string }).code;
  }
}

async function until(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 2));
  }
}

function manager(
  opts: { finished?: Room[]; updates?: Room[]; errors?: unknown[]; settled?: { userId: string; delta: number }[][]; nextHandDelay?: number } = {},
) {
  return new RoomManager({
    rng: seededRng(5),
    aiMoveDelayMs: 0,
    pokerBotDelayMs: 0,
    pokerNextHandDelayMs: opts.nextHandDelay ?? 60_000,
    onChessFinished: async (room) => {
      opts.finished?.push(room);
    },
    onPokerSettled: async (_room, _handId, deltas) => {
      opts.settled?.push(deltas);
    },
    onRoomUpdate: (room) => opts.updates?.push(room),
    onBackgroundError: (err) => opts.errors?.push(err),
  });
}

describe('chess computer opponent room (AC-11)', () => {
  it('creates an unlisted, active AI game where the user plays red against the computer', async () => {
    const rm = manager();
    const room = await rm.createAiGame(alice);
    expect(room.mode).toBe('ai');
    expect(room.chess?.status).toBe('active');
    expect(rm.list()).toEqual([]);
    expect(rm.currentRoomId('a')).toBe(room.id);
    const view = viewFor(room, 'a').chess!;
    expect(view.yourColor).toBe('red');
    expect(view.turn).toBe('red');
    expect(view.players.black).toEqual({ computer: true, username: '电脑' });
    expect(await code(rm.join(bob, room.id))).toBe('ROOM_NOT_FOUND');
    expect(await code(rm.createAiGame(alice))).toBe('ALREADY_IN_ROOM');
    expect(await code(rm.create(alice, 'poker'))).toBe('ALREADY_IN_ROOM');
  });

  it('the computer moves on its own after the user moves', async () => {
    const updates: Room[] = [];
    const rm = manager({ updates });
    const room = await rm.createAiGame(alice);
    await rm.chessMove('a', room.id, 'a3', 'a4');
    expect(room.chess!.turn).toBe('black');
    await until(() => room.chess!.turn === 'red');
    expect(room.chess!.lastMove?.side).toBe('black');
    expect(updates).toContain(room);
    // The user can keep playing.
    await rm.chessMove('a', room.id, 'i3', 'i4');
    await until(() => room.chess!.turn === 'red' || room.chess!.status === 'finished');
  });

  it('the computer accepts a draw offer at once', async () => {
    const finished: Room[] = [];
    const rm = manager({ finished });
    const room = await rm.createAiGame(alice);
    await rm.chessDrawOffer('a', room.id);
    expect(room.chess!.status).toBe('finished');
    expect(room.chess!.result).toMatchObject({ outcome: 'draw', reason: 'draw_agreed' });
    expect(finished).toEqual([room]);
  });

  it('leaving an AI game resigns and closes it; a pending computer move is dropped', async () => {
    const finished: Room[] = [];
    const errors: unknown[] = [];
    const rm = manager({ finished, errors });
    const room = await rm.createAiGame(alice);
    await rm.chessMove('a', room.id, 'a3', 'a4');
    await rm.leave('a', room.id);
    expect(room.chess!.result).toMatchObject({ outcome: 'black_win', reason: 'resign' });
    expect(rm.get(room.id)).toBeUndefined();
    await new Promise((r) => setTimeout(r, 20));
    expect(room.chess!.lastMove?.side).toBe('red');
    expect(errors).toEqual([]);
  });
});

describe('poker computer players (spec AC-17)', () => {
  it('only the host adds bots, never during a hand, and bots count toward the room size', async () => {
    const rm = manager();
    const room = await rm.create(alice, 'poker');
    expect(await code(rm.pokerStart('a', room.id))).toBe('NOT_ENOUGH_PLAYERS');
    await rm.join(bob, room.id);
    expect(await code(rm.addPokerBot('b', room.id))).toBe('NOT_HOST');
    expect(room.poker!.seats.filter(Boolean)).toHaveLength(2);
    await rm.addPokerBot('a', room.id);
    const seats = viewFor(room, 'a').poker!.seats;
    expect(seats[2]).toMatchObject({ kind: 'bot', name: '电脑 1', chips: 1000 });
    expect(seats[2]).not.toHaveProperty('userId');
    expect(rm.list()[0]).toMatchObject({ players: 3, capacity: 9 });
    await rm.pokerStart('a', room.id);
    expect(await code(rm.addPokerBot('a', room.id))).toBe('HAND_IN_PROGRESS');
  });

  it('a full table rejects another bot', async () => {
    const rm = manager();
    const room = await rm.create(alice, 'poker');
    for (let i = 0; i < 8; i++) await rm.addPokerBot('a', room.id);
    expect(room.poker!.seats.map((s) => s?.name)).toContain('电脑 8');
    expect(rm.list()[0]).toMatchObject({ players: 9, full: true });
    expect(await code(rm.addPokerBot('a', room.id))).toBe('ROOM_FULL');
    expect(await code(rm.join(bob, room.id))).toBe('ROOM_FULL');
  });

  it('a lone host with a bot can start; the bot acts on its own and its chips stay in the room', async () => {
    const updates: Room[] = [];
    const settled: { userId: string; delta: number }[][] = [];
    const rm = manager({ updates, settled });
    const room = await rm.create(alice, 'poker');
    await rm.addPokerBot('a', room.id);
    await rm.pokerStart('a', room.id);
    const poker = room.poker!;
    // Heads-up: the host is dealer and small blind, acts first; then it is the bot's turn.
    await rm.pokerAction('a', room.id, { type: 'call' });
    await until(() => poker.hand!.toAct === 0 || poker.hand!.stage === 'showdown' || poker.hand!.stage === 'complete');
    expect(poker.hand!.actions.some((x) => x.seat === 1 && !['small_blind', 'big_blind'].includes(x.type))).toBe(true);
    expect(updates.length).toBeGreaterThan(0);
    // Play the hand out by checking / calling.
    while (poker.hand!.toAct === 0) {
      const legal = legalActions(poker.hand!, 0)!;
      await rm.pokerAction('a', room.id, { type: legal.check ? 'check' : 'call' });
      await until(() => poker.hand!.toAct !== 1);
    }
    expect(['showdown', 'complete']).toContain(poker.hand!.stage);
    const humanNet = settled.flat().reduce((s, d) => s + d.delta, 0);
    expect(settled.flat().every((d) => d.userId === 'a')).toBe(true);
    const botSeat = viewFor(room, 'a').poker!.seats.find((s) => s.kind === 'bot')!;
    expect(botSeat.chips).toBe(1000 - humanNet);
  });

  it('bots keep playing automatic hands with each other and are removed with the room', async () => {
    const errors: unknown[] = [];
    const rm = manager({ errors, nextHandDelay: 0 });
    const room = await rm.create(alice, 'poker');
    await rm.addPokerBot('a', room.id);
    await rm.addPokerBot('a', room.id);
    await rm.pokerStart('a', room.id);
    // The host folds whenever it is their turn; bots finish the hands by themselves.
    const poker = room.poker!;
    while (poker.handNumber < 4) {
      if (poker.hand && poker.hand.toAct === 0) await rm.pokerAction('a', room.id, { type: 'fold' });
      await new Promise((r) => setTimeout(r, 2));
    }
    const view = viewFor(room, 'a').poker!;
    const botChips = view.seats.filter((s) => s.kind === 'bot').map((s) => s.chips);
    expect(botChips).toHaveLength(2);
    await rm.leave('a', room.id);
    expect(rm.get(room.id)).toBeUndefined();
    await new Promise((r) => setTimeout(r, 20));
    expect(errors).toEqual([]);
  });
});
