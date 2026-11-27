import { expect, test, type Page } from '@playwright/test';
import { newUser } from './support/users.js';

async function chipsOf(page: Page): Promise<number> {
  const res = await page.request.get('/api/me');
  return ((await res.json()) as { user: { chips: number } }).user.chips;
}

test('德州扑克：开局盲注与底牌私密、加注实时同步、弃牌结算筹码并自动开始下一手', async ({ browser }) => {
  const host = await newUser(browser, 'phost');
  const guest = await newUser(browser, 'pguest');
  await host.page.goto('/lobby');
  await host.page.getByRole('button', { name: '开德州扑克房间' }).click();
  await expect(host.page.getByRole('heading', { name: '德州扑克房间' })).toBeVisible();
  const roomPath = new URL(host.page.url()).pathname;
  const roomId = roomPath.split('/').pop() as string;
  expect((await guest.page.request.post(`/api/rooms/${roomId}/join`, { data: {} })).status()).toBe(200);
  await guest.page.goto(roomPath);
  await expect(guest.page.getByRole('region', { name: '牌桌' })).toBeVisible();
  await expect(guest.page.getByRole('button', { name: '开始牌局' })).toHaveCount(0);

  const start = host.page.getByRole('button', { name: '开始牌局' });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(start).toBeDisabled();

  for (const u of [host, guest]) {
    await expect(u.page.getByRole('status', { name: '底池' })).toHaveText('底池：15');
    await expect(u.page.getByRole('region', { name: '我的底牌' }).getByRole('img')).toHaveCount(2);
  }
  const hostSeatForGuest = guest.page.getByRole('region', { name: `座位 1：${host.username}` });
  await expect(hostSeatForGuest).toContainText('庄家');
  await expect(hostSeatForGuest).toContainText('小盲');
  await expect(hostSeatForGuest).toContainText('筹码：995');
  await expect(hostSeatForGuest).toContainText('本手投入：5');
  await expect(hostSeatForGuest.getByRole('img')).toHaveCount(0);
  await expect(guest.page.getByRole('region', { name: `座位 2：${guest.username}` })).toContainText('大盲');
  await expect(guest.page.getByRole('log', { name: '牌局记录' })).toContainText(`${host.username} 小盲 5`);

  // Heads-up: the dealer (small blind) acts first preflop.
  await expect(guest.page.getByRole('button', { name: '弃牌' })).toBeDisabled();
  await expect(host.page.getByRole('button', { name: '跟注 5' })).toBeEnabled();
  await expect(host.page.getByRole('button', { name: '过牌' })).toBeDisabled();
  const amount = host.page.getByRole('spinbutton', { name: '金额' });
  await expect(amount).toHaveValue('20');
  await amount.fill('40');
  await host.page.getByRole('button', { name: '加注' }).click();

  await expect(guest.page.getByRole('log', { name: '牌局记录' })).toContainText(`${host.username} 加注到 40`);
  await expect(guest.page.getByRole('status', { name: '底池' })).toHaveText('底池：50');
  await guest.page.getByRole('button', { name: '弃牌' }).click();

  await expect.poll(() => chipsOf(host.page)).toBe(1010);
  await expect.poll(() => chipsOf(guest.page)).toBe(990);

  // Next hand starts automatically with the dealer button moved to the guest.
  await expect(host.page.getByRole('region', { name: `座位 2：${guest.username}` })).toContainText('庄家');
  await expect(host.page.getByRole('status', { name: '底池' })).toHaveText('底池：15');
  await expect(guest.page.getByRole('button', { name: '跟注 5' })).toBeEnabled();
  for (const u of [host, guest]) await u.context.close();
});
