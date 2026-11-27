import { expect, test } from '@playwright/test';
import { uniqueName } from './support/users.js';

test('注册后进入大厅，换浏览器用同一账号登录', async ({ page, browser }) => {
  const username = uniqueName('reg');
  await page.goto('/register');
  await page.getByRole('textbox', { name: '用户名' }).fill(username);
  await page.getByLabel('密码').fill('pw-123456');
  await page.getByRole('button', { name: '注册' }).click();

  await expect(page.getByRole('heading', { name: '游戏大厅' })).toBeVisible();
  const info = page.getByRole('region', { name: '我的信息' });
  await expect(info).toContainText(username);
  await expect(info).toContainText('象棋积分 1000');
  await expect(info).toContainText('扑克筹码 1000');

  const other = await browser.newContext();
  const page2 = await other.newPage();
  await page2.goto('/login');
  await page2.getByRole('textbox', { name: '用户名' }).fill(username);
  await page2.getByLabel('密码').fill('wrong');
  await page2.getByRole('button', { name: '登录' }).click();
  await expect(page2.getByRole('alert')).toHaveText('用户名或密码错误');

  await page2.getByLabel('密码').fill('pw-123456');
  await page2.getByRole('button', { name: '登录' }).click();
  await expect(page2.getByRole('region', { name: '我的信息' })).toContainText(username);
  await other.close();
});

test('未登录访问大厅被带到登录页', async ({ page }) => {
  await page.goto('/lobby');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible();
  await page.getByRole('link', { name: '没有账号？去注册' }).click();
  await page.getByRole('button', { name: '注册' }).click();
  await expect(page.getByRole('alert')).toHaveText('用户名为必填项');
});
