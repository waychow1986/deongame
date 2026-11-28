// TS-01 .. TS-06: entering site, lobby, back-to-game
import { BASE, openPage, gotoLobby, isRed, parseRgb, sleep, onlineChess } from '../lib.mjs';

async function loginViaPage(page, api) {
  await page.goto(BASE + '/login');
  await page.getByRole('textbox', { name: '用户名' }).fill(api.username);
  await page.getByLabel('密码').fill(api.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
}

export const scenarios = [
  {
    id: 'TS-01', group: 'A', limitMinutes: 4,
    async run(ctx) {
      const { u1, u2, roomId } = await onlineChess();
      ctx.track(u1); ctx.track(u2);
      const page = await openPage(ctx, u1);
      await page.goto(BASE + '/room/' + roomId);
      await page.waitForURL(/\/room\//);
      // logout via public API (session invalidated), then login on login page
      await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
      await page.context().clearCookies();
      await loginViaPage(page, u1);
      await page.getByRole('heading', { name: 'DeonGame' }).waitFor({ timeout: 15000 }).catch(() => {});
      await sleep(2000);
      const url1 = page.url();
      const lobby1 = await page.getByRole('table', { name: '房间列表' }).isVisible().catch(() => false);
      await ctx.shot(page, 'cp1');
      ctx.check('1 有进行中对局的用户登录后显示大厅', /\/lobby/.test(url1) && !/\/room\//.test(url1) && lobby1, `url=${url1.replace(BASE, '')} roomList=${lobby1}`);
      await u1.login(); // refresh api cookie for cleanup

      const u3 = await ctx.reg('n');
      const p3 = await openPage(ctx, u3);
      await gotoLobby(p3);
      await p3.getByRole('button', { name: '退出登录' }).click();
      await p3.waitForURL(/\/login/, { timeout: 10000 }).catch(() => {});
      await loginViaPage(p3, u3);
      await p3.getByRole('heading', { name: 'DeonGame' }).waitFor({ timeout: 15000 }).catch(() => {});
      await sleep(1000);
      const url3 = p3.url();
      ctx.check('2 无对局用户退出后重新登录显示大厅', /\/lobby/.test(url3), `url=${url3.replace(BASE, '')}`);
      await u3.login();

      const p4 = await openPage(ctx, null);
      await p4.goto(BASE + '/register');
      const name = `qa_${Date.now().toString(36)}_reg`;
      await p4.getByRole('textbox', { name: '用户名' }).fill(name);
      await p4.getByLabel('密码').fill('Pw' + Math.random().toString(36).slice(2, 12));
      await p4.getByRole('button', { name: '注册', exact: true }).click();
      await p4.getByRole('heading', { name: 'DeonGame' }).waitFor({ timeout: 15000 }).catch(() => {});
      await sleep(1000);
      const url4 = p4.url();
      const lobby4 = await p4.getByRole('table', { name: '房间列表' }).isVisible().catch(() => false);
      await ctx.shot(p4, 'cp3');
      ctx.check('3 注册成功后显示大厅', /\/lobby/.test(url4) && lobby4, `url=${url4.replace(BASE, '')} roomList=${lobby4}`);
    },
  },
];
