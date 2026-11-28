import { expect, type Page } from '@playwright/test';

export const ROOM_URL = /\/room\/[0-9a-f-]{36}$/;

export type OpenRoomOptions =
  | { game: 'chess'; mode?: 'online' | 'ai' }
  | { game: 'poker'; capacity?: number };

/** Opens a room through the lobby game card and the "开房间" dialog, then waits for the room page. */
export async function openRoomViaDialog(page: Page, opts: OpenRoomOptions): Promise<void> {
  const card = opts.game === 'chess' ? /^中国象棋·盲棋/ : /^德州扑克/;
  await page.getByRole('button', { name: card }).click();
  const dialog = page.getByRole('dialog', { name: '开房间' });
  await expect(dialog).toBeVisible();
  if (opts.game === 'chess' && opts.mode === 'ai') {
    await dialog.getByRole('radio', { name: '和电脑对战' }).check();
  }
  if (opts.game === 'poker' && opts.capacity !== undefined) {
    await dialog.getByRole('combobox', { name: '人数上限' }).selectOption(String(opts.capacity));
  }
  await dialog.getByRole('button', { name: '确认' }).click();
  await expect(page).toHaveURL(ROOM_URL);
}

/** Uses the room page "离开房间" button and confirms the leave dialog. */
export async function leaveRoomConfirmed(page: Page): Promise<void> {
  await page.getByRole('button', { name: '离开房间' }).click();
  await page.getByRole('dialog', { name: '确认离开房间' }).getByRole('button', { name: '确认离开' }).click();
}
