// Smoke candidate (from TS-24): poker table with a computer player shows my seat, my face-up hole cards and the action area.
import { openPage, gotoRoom, waitFor, sleep } from '../lib.mjs';

const SUIT = { s: '黑桃', h: '红桃', d: '方块', c: '梅花' };
const RANK = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' };
const label = (c) => SUIT[c[1]] + (RANK[c[0]] || c[0]);

export const scenarios = [
  {
    id: 'SMOKE-POKER-TABLE', group: 'A', limitMinutes: 4,
    async run(ctx) {
      const u = await ctx.reg('sp');
      const room = await u.createRoom('poker', 3);
      await u.addBot(room.id);
      const page = await openPage(ctx, u);
      await gotoRoom(page, room.id);
      const start = page.getByRole('button', { name: '开始牌局' });
      await start.waitFor({ timeout: 15000 });
      await start.click();
      const s = await waitFor(async () => { const t = await u.state(room.id); return t.poker?.handId ? t : null; }, { timeout: 20000 });
      const table = page.getByRole('region', { name: '牌桌' });
      await table.waitFor({ timeout: 15000 });
      const mySeat = page.getByRole('region', { name: /^座位 / }).and(page.locator('[data-me="true"]'));
      const seatCount = await page.getByRole('region', { name: /^座位 / }).count();
      ctx.check('1 牌桌显示两个座位，其中一个是我', seatCount === 2 && (await mySeat.count()) === 1, `seats=${seatCount}`);

      const hole = s.poker.seats.find((x) => x.userId === u.user?.id || x.kind === 'human')?.holeCards || [];
      let shown = false;
      await waitFor(async () => {
        const n = await Promise.all(hole.map((c) => mySeat.getByRole('img', { name: label(c) }).count()));
        shown = hole.length === 2 && n.every((x) => x > 0);
        return shown || null;
      }, { timeout: 20000 }).catch(() => {});
      await ctx.shot(page, 'table');
      ctx.check('2 我的两张手牌正面朝上显示', shown, `hole=${hole.map(label).join(',')}`);

      const ops = page.getByRole('region', { name: '操作区' });
      const fold = ops.getByRole('button', { name: '弃牌' });
      const ok = await waitFor(async () => (await fold.isEnabled().catch(() => false)) || null, { timeout: 20000 }).catch(() => false);
      ctx.check('3 轮到我时操作区可以弃牌', !!ok, '');
      await sleep(200);
    },
  },
];
