import { describe, expect, it } from 'vitest';
import { RoomManager, type Room } from '../../src/server/rooms/roomManager.js';
import { viewFor } from '../../src/server/rooms/view.js';
import { seededRng } from '../../src/shared/rng.js';

const alice = { userId: 'a', username: 'alice' };
const bob = { userId: 'b', username: 'bob' };
const carol = { userId: 'c', username: 'carol' };

interface Settled {
  handId: string;
  deltas: { userId: string; delta: number }[];
}

function manager(opts: { balances?: Record<string, number>; settled?: Settled[]; updates?: Room[]; delay?: number } = {}) {
  const balances = opts.balances ?? {};
  return new RoomManager({
    rng: seededRng(9),
    pokerNextHandDelayMs: opts.delay ?? 60_000,
    loadChips: async (ids) => new Map(ids.map((id) => [id, balances[id] ?? 1000])),
    onPokerSettled: async (_room, handId, deltas) => {
      opts.settled?.push({ handId, deltas });
      for (const d of deltas) balances[d.userId] = (balances[d.userId] ?? 1000) + d.delta;
    },
    onPokerUpdate: (room) => opts.updates?.push(room),
  });
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'none';
  } catch (err) {
    return (err as { code: string }).code;
  }
}

async function table(rm: RoomManager, ...users: { userId: string; username: string }[]) {
  const room = await rm.create(users[0]!, 'poker');
  for (const u of users.slice(1)) await rm.join(u, room.id);
  return room;
}

describe('poker view (DC-02)', () => {
  it('shows each viewer only their own hole cards while the hand is running', async () => {
    const rm = manager();
    const room = await table(rm, alice, bob, carol);
    await rm.pokerStart('a', room.id);
    for (const viewer of ['a', 'b', 'c']) {
      const poker = viewFor(room, viewer).poker!;
      expect(poker.stage).toBe('preflop');
      for (const s of poker.seats) {
        if (s.userId === viewer) expect(s.holeCards).toHaveLength(2);
        else expect(s).not.toHaveProperty('holeCards');
      }
      const others = room.poker!.hand!.players.filter((p) => poker.seats.find((s) => s.seat === p.seat)?.userId !== viewer);
      const json = JSON.stringify(viewFor(room, viewer));
      for (const p of others) for (const card of p.hole) expect(json).not.toContain(`"${card}"`);
    }
    // A viewer that is not seated sees no hole cards at all.
    expect(viewFor(room, 'x').poker!.seats.every((s) => !('holeCards' in s))).toBe(true);
  });

  it('does not reveal hole cards when the hand ends by folds; reveals them at showdown', async () => {
    const rm = manager();
    const room = await table(rm, alice, bob);
    await rm.pokerStart('a', room.id);
    await rm.pokerAction('a', room.id, { type: 'fold' });
    const poker = viewFor(room, 'b').poker!;
    expect(poker.stage).toBe('complete');
    expect(poker.showdown).toEqual([]);
    expect(poker.seats.find((s) => s.userId === 'a')).not.toHaveProperty('holeCards');
    expect(poker.winners).toEqual([{ seat: 1, name: 'bob', amount: 15 }]);
  });
});

describe('poker room service', () => {
  it('only the host may start, with at least two seated players, once', async () => {
    const rm = manager();
    const room = await rm.create(alice, 'poker');
    expect(await code(rm.pokerStart('a', room.id))).toBe('NOT_ENOUGH_PLAYERS');
    await rm.join(bob, room.id);
    expect(await code(rm.pokerStart('b', room.id))).toBe('NOT_HOST');
    await rm.pokerStart('a', room.id);
    expect(await code(rm.pokerStart('a', room.id))).toBe('HAND_IN_PROGRESS');
  });

  it('deducts blinds from the displayed chips; dealer is the host seat (heads-up dealer posts SB)', async () => {
    const rm = manager({ balances: { a: 1000, b: 0 } });
    const room = await table(rm, alice, bob);
    await rm.pokerStart('a', room.id);
    const poker = viewFor(room, 'a').poker!;
    expect(poker.seats.map((s) => [s.name, s.chips, s.committedThisHand, s.isDealer, s.isSmallBlind, s.isBigBlind])).toEqual([
      ['alice', 995, 5, true, true, false],
      ['bob', -10, 10, false, false, true],
    ]);
    expect(poker.pot).toBe(15);
    expect(poker.toActSeat).toBe(0);
    expect(poker.you).toEqual({
      seat: 0,
      legal: { fold: true, check: false, call: true, callAmount: 5, bet: false, raise: true, minRaiseTo: 20, maxRaiseTo: 1000 },
    });
    expect(viewFor(room, 'b').poker!.you).toEqual({ seat: 1, legal: null });
    expect(poker.actions).toEqual([
      { seat: 0, name: 'alice', type: 'small_blind', amount: 5 },
      { seat: 1, name: 'bob', type: 'big_blind', amount: 10 },
    ]);
  });

  it('rejects out-of-turn and illegal actions with specific reasons, state unchanged', async () => {
    const rm = manager();
    const room = await table(rm, alice, bob);
    await rm.pokerStart('a', room.id);
    const before = room.version;
    expect(await code(rm.pokerAction('b', room.id, { type: 'call' }))).toBe('NOT_YOUR_TURN');
    await expect(rm.pokerAction('a', room.id, { type: 'check' })).rejects.toMatchObject({
      code: 'ILLEGAL_ACTION',
      message: '当前需要跟注，不能过牌',
    });
    await expect(rm.pokerAction('a', room.id, { type: 'raise', amount: 1001 })).rejects.toMatchObject({
      message: '超出每手下注上限 1000',
    });
    expect(room.version).toBe(before);
  });

  it('settles every human net once at hand end and starts the next hand with the dealer moved on', async () => {
    const settled: Settled[] = [];
    const updates: Room[] = [];
    const rm = manager({ settled, updates, delay: 0 });
    const room = await table(rm, alice, bob, carol);
    await rm.pokerStart('a', room.id);
    const handId = room.poker!.hand!.id;
    await rm.pokerAction('a', room.id, { type: 'raise', amount: 30 });
    await rm.pokerAction('b', room.id, { type: 'fold' });
    await rm.pokerAction('c', room.id, { type: 'fold' });
    expect(settled).toEqual([
      {
        handId,
        deltas: [
          { userId: 'a', delta: 15 },
          { userId: 'b', delta: -5 },
          { userId: 'c', delta: -10 },
        ],
      },
    ]);
    expect(viewFor(room, 'a').poker!.seats.map((s) => s.chips)).toEqual([1015, 995, 990]);
    await new Promise((r) => setTimeout(r, 20));
    expect(updates.length).toBeGreaterThan(0);
    const next = viewFor(room, 'a').poker!;
    expect(next.handNumber).toBe(2);
    expect(next.stage).toBe('preflop');
    expect(next.seats.find((s) => s.isDealer)?.seat).toBe(1);
  });

  it('a DB failure when auto-starting the next hand is caught and logged; the host can start again', async () => {
    const errors: { err: unknown; roomId: string }[] = [];
    let failLoads = 0;
    const rm = new RoomManager({
      rng: seededRng(9),
      pokerNextHandDelayMs: 0,
      loadChips: async (ids) => {
        if (failLoads > 0) {
          failLoads -= 1;
          throw new Error('connection reset');
        }
        return new Map(ids.map((id) => [id, 1000]));
      },
      onBackgroundError: (err, info) => errors.push({ err, roomId: info.roomId }),
    });
    const room = await table(rm, alice, bob);
    await rm.pokerStart('a', room.id);
    failLoads = 1;
    await rm.pokerAction('a', room.id, { type: 'fold' });
    await new Promise((r) => setTimeout(r, 30));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ roomId: room.id, err: { message: 'connection reset' } });
    expect(viewFor(room, 'a').poker!).toMatchObject({ handNumber: 1, stage: 'complete' });
    await rm.pokerStart('a', room.id);
    expect(viewFor(room, 'a').poker!).toMatchObject({ handNumber: 2, stage: 'preflop' });
  });

  it('a mid-hand joiner waits for the next hand; a leaver is folded and settled at −committed', async () => {
    const settled: Settled[] = [];
    const rm = manager({ settled });
    const room = await table(rm, alice, bob, carol);
    await rm.pokerStart('a', room.id);
    const dave = { userId: 'd', username: 'dave' };
    await rm.join(dave, room.id);
    const d = viewFor(room, 'd').poker!.seats.find((s) => s.userId === 'd')!;
    expect(d).toMatchObject({ waitingNextHand: true, inHand: false });
    expect(d).not.toHaveProperty('holeCards');
    await rm.pokerAction('a', room.id, { type: 'call' });
    await rm.leave('c', room.id); // big blind leaves out of turn
    expect(settled).toEqual([{ handId: room.poker!.hand!.id, deltas: [{ userId: 'c', delta: -10 }] }]);
    expect(room.poker!.hand!.actions.at(-1)).toMatchObject({ type: 'leave_fold' });
    expect(viewFor(room, 'a').poker!.actions.at(-1)).toMatchObject({ name: 'carol', type: 'leave_fold' });
    await rm.leave('b', room.id); // small blind leaves on turn: only alice remains
    expect(viewFor(room, 'a').poker!.stage).toBe('complete');
    expect(settled.at(-1)).toEqual({ handId: room.poker!.hand!.id, deltas: [{ userId: 'a', delta: 15 }] });
  });
});
