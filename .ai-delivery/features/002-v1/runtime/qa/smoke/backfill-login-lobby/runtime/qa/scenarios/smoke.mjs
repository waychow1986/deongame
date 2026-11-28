// Backfilled old main path (system-current): register an account, see own rating/chips in the lobby, log out, log in again.
import { BASE, openPage, sleep } from '../lib.mjs';

export const scenarios = [
  {
    id: 'SMOKE-LOGIN-LOBBY', group: 'A', limitMinutes: 3,
    async run(ctx) {
      const page = await openPage(ctx, null);
      await page.goto(BASE + '/register');
      const name = `qa_${Date.now().toString(36)}_sm`;
      const pw = 'Pw' + Math.random().toString(36).slice(2, 12);
      await page.getByRole('textbox', { name: '用户名' }).fill(name);
      await page.getByLabel('密码').fill(pw);
      await page.getByRole('button', { name: '注册', exact: true }).click();
      const info = page.getByRole('region', { name: '我的信息' });
      await info.getByText(/象棋积分/).waitFor({ timeout: 15000 }).catch(() => {});
      const t = (await info.textContent().catch(() => '')) || '';
      ctx.check('1 注册后进入大厅，显示用户名与初始积分、筹码', t.includes(name) && /象棋积分\s*1000/.test(t) && /扑克筹码\s*1000/.test(t), t.slice(0, 120));

      await page.getByRole('button', { name: '退出登录' }).click();
      await page.waitForURL(/\/login/, { timeout: 10000 }).catch(() => {});
      ctx.check('2 退出登录后回到登录页', /\/login/.test(page.url()), page.url().replace(BASE, ''));

      await page.getByRole('textbox', { name: '用户名' }).fill(name);
      await page.getByLabel('密码').fill(pw);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await page.getByRole('table', { name: '房间列表' }).waitFor({ timeout: 15000 }).catch(() => {});
      await sleep(500);
      ctx.check('3 重新登录后进入大厅并看到房间列表', /\/lobby/.test(page.url()) && await page.getByRole('table', { name: '房间列表' }).isVisible().catch(() => false), page.url().replace(BASE, ''));
      await ctx.shot(page, 'lobby');
    },
  },
];
