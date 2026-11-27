import type { Browser, BrowserContext, Page } from '@playwright/test';

export function uniqueName(label: string): string {
  const run = process.env.E2E_RUN_ID ?? 'local';
  return `qa_${run}_${label}_${Math.random().toString(36).slice(2, 6)}`;
}

/** Creates a user through the public API inside a fresh browser context (registering also logs in). */
export async function newUser(
  browser: Browser,
  label: string,
): Promise<{ context: BrowserContext; page: Page; username: string }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const username = uniqueName(label);
  const res = await page.request.post('/api/auth/register', { data: { username, password: 'pw-123456' } });
  if (res.status() !== 201) throw new Error(`register failed: ${res.status()}`);
  return { context, page, username };
}
