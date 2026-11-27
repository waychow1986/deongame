// Backfilled old main path (system-current): two players start an online blind-chess game; each side makes a legal move.
import { onlineChess, waitFor, openPage, gotoRoom } from '../lib.mjs';

async function moveFirstLegal(api, roomId) {
  const s = await api.state(roomId);
  const lm = s.chess?.legalMoves || {};
  const from = Object.keys(lm)[0];
  if (!from) return { ok: false, info: 'no legal moves' };
  const r = await api.move(roomId, from, lm[from][0]);
  return { ok: r.status === 200, info: `${from}->${lm[from][0]} status=${r.status}` };
}

export const scenarios = [
  {
    id: 'SMOKE-ONLINE-CHESS', group: 'A', limitMinutes: 3,
    async run(ctx) {
      const { u1, u2, roomId } = await onlineChess();
      ctx.track(u1); ctx.track(u2);
      const s0 = await u1.state(roomId);
      ctx.check('1 两人进入房间后对局开始，红方先走', s0.chess?.status === 'active' && s0.chess?.turn === 'red', `status=${s0.chess?.status} turn=${s0.chess?.turn}`);
      const m1 = await moveFirstLegal(u1, roomId);
      const s1 = await waitFor(async () => { const t = await u2.state(roomId); return t.chess?.turn === 'black' ? t : null; }, { timeout: 15000 }).catch(() => null);
      ctx.check('2 红方走一步合法棋后轮到黑方', m1.ok && !!s1, m1.info);
      const m2 = await moveFirstLegal(u2, roomId);
      const s2 = await waitFor(async () => { const t = await u1.state(roomId); return t.chess?.turn === 'red' ? t : null; }, { timeout: 15000 }).catch(() => null);
      ctx.check('3 黑方走一步合法棋后轮到红方', m2.ok && !!s2, m2.info);
      const page = await openPage(ctx, u1);
      await gotoRoom(page, roomId);
      const board = page.getByRole('group', { name: '棋盘' });
      await board.waitFor({ timeout: 15000 }).catch(() => {});
      await ctx.shot(page, 'board');
      ctx.check('4 红方在房间页看到棋盘', await board.isVisible().catch(() => false), '');
    },
  },
];
