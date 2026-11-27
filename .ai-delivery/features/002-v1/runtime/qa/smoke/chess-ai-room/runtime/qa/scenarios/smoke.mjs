// Smoke candidate (from TS-07): open a chess room against the computer from the lobby and make one move by clicking.
import { openPage, gotoLobby, waitFor, waitBoardIdle, cell, sleep } from '../lib.mjs';

export const scenarios = [
  {
    id: 'SMOKE-CHESS-AI', group: 'A', limitMinutes: 4,
    async run(ctx) {
      const u = await ctx.reg('sc');
      const page = await openPage(ctx, u);
      await gotoLobby(page);
      await page.getByRole('button', { name: /^中国象棋·盲棋/ }).click();
      const dlg = page.getByRole('dialog', { name: '开房间' });
      await dlg.waitFor({ timeout: 10000 });
      await dlg.getByRole('radio', { name: '和电脑对战' }).click();
      await dlg.getByRole('button', { name: '确认' }).click();
      await page.waitForURL(/\/room\//, { timeout: 15000 });
      const board = page.getByRole('group', { name: '棋盘' });
      await board.waitFor({ timeout: 15000 });
      const st = (await page.getByRole('status', { name: '对局状态' }).textContent().catch(() => '')) || '';
      ctx.check('1 从大厅开“和电脑对战”的象棋房间后显示棋盘，我执红', /你执红/.test(st), `status=${st}`);

      const roomId = page.url().split('/room/')[1].split(/[?#]/)[0];
      const s = await u.state(roomId);
      const lm = s.chess?.legalMoves || {};
      const from = Object.keys(lm)[0];
      const to = from && lm[from][0];
      ctx.check('2 轮到我走棋且有合法走法', s.chess?.turn === 'red' && !!to, `turn=${s.chess?.turn} from=${from} to=${to}`);
      if (!to) return;
      await waitBoardIdle(page, 30000);
      await cell(page, from).click();
      await sleep(300);
      await cell(page, to).click();
      const moved = await waitFor(async () => {
        const t = await u.state(roomId);
        return t.chess?.lastMove || (t.chess?.turn === 'black') ? t : null;
      }, { timeout: 20000 }).catch(() => null);
      await ctx.shot(page, 'moved');
      ctx.check('3 在棋盘上点按走棋后这一步被记录', !!moved, `move=${from}->${to} lastMove=${JSON.stringify(moved?.chess?.lastMove || null)}`);
    },
  },
];
