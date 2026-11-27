// Smoke (from TS-22): start a game against the computer from the lobby, move a3->a4 on the board, the computer replies.
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';

const resultPath = process.env.QA_RESULT_PATH || path.join(process.cwd(), 'result.json');
const checkpoints = [];
const cp = (step, ok, obs) => { checkpoints.push({ step, passed: !!ok, observation: (typeof obs === 'string' ? obs : JSON.stringify(obs)).slice(0, 1500) }); };
const write = () => fs.writeFileSync(resultPath, JSON.stringify({
  schemaVersion: 2,
  testedCommitSha: process.env.QA_CANDIDATE_SHA || '',
  summary: `冒烟：与电脑下盲棋走一步、电脑应着；${checkpoints.every((c) => c.passed) && checkpoints.length ? '通过' : '未通过'}`,
  scenarios: checkpoints.length ? [{ id: 'SMOKE-AI-CHESS', passed: checkpoints.length > 0 && checkpoints.every((c) => c.passed), checkpoints, evidence: [] }] : [],
}, null, 2));

write();
let u;
try {
  u = await L.newUser('smc');
  const page = await L.newPage(u);
  await page.goto(L.BASE + '/lobby');
  await page.getByRole('button', { name: '与电脑下盲棋' }).click();
  await page.waitForURL(/\/room\//, { timeout: L.WAIT_MS }).catch(() => {});
  const id = (page.url().match(/\/room\/([^/?#]+)/) || [])[1];
  const g = page.getByRole('group', { name: '棋盘' });
  const ok1 = await g.waitFor({ timeout: L.WAIT_MS }).then(() => true).catch(() => false);
  const st = (await page.getByRole('status').allInnerTexts().catch(() => [])).join(' | ');
  cp('大厅点“与电脑下盲棋”进入对局，执红、轮到自己', !!id && ok1 && /你执红/.test(st) && /轮到你走棋/.test(st), { url: page.url(), st });
  const s0 = id ? await u.state(id) : null;
  await g.getByRole('button', { name: /^a3 / }).click();
  await g.getByRole('button', { name: /^a4 / }).click();
  const s1 = await L.waitFor(async () => {
    const s = await u.state(id);
    return s && s.version > s0.version && s.chess.turn === 'red' && s.chess.lastMove && s.chess.lastMove.side === 'black' ? s : null;
  });
  cp('走 a3→a4 被接受，电脑自动走一步黑棋后轮到自己', !!s1, s1 ? s1.chess.lastMove : 'computer did not reply');
  if (id) await u.resign(id).catch(() => {});
} catch (e) {
  cp('脚本执行异常', false, String(e && e.stack ? e.stack : e));
}
await L.closePages('smoke', false).catch(() => {});
await L.cleanupTracked().catch(() => {});
await L.closeBrowser();
write();
process.exit(0);
