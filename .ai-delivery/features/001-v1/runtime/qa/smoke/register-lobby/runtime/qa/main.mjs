// Smoke (from TS-01): register in the browser -> lobby shows the user with rating 1000 / chips 1000 -> log in from a fresh browser.
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';

const resultPath = process.env.QA_RESULT_PATH || path.join(process.cwd(), 'result.json');
const checkpoints = [];
const cp = (step, ok, obs) => { checkpoints.push({ step, passed: !!ok, observation: (typeof obs === 'string' ? obs : JSON.stringify(obs)).slice(0, 1500) }); };
const write = () => fs.writeFileSync(resultPath, JSON.stringify({
  schemaVersion: 2,
  testedCommitSha: process.env.QA_CANDIDATE_SHA || '',
  summary: `冒烟：注册并进入大厅、重新登录；${checkpoints.every((c) => c.passed) && checkpoints.length ? '通过' : '未通过'}`,
  scenarios: checkpoints.length ? [{ id: 'SMOKE-REGISTER-LOBBY', passed: checkpoints.length > 0 && checkpoints.every((c) => c.passed), checkpoints, evidence: [] }] : [],
}, null, 2));

async function info(page) {
  const r = page.getByRole('region', { name: '我的信息' });
  await r.waitFor({ timeout: L.WAIT_MS }).catch(() => {});
  await page.waitForTimeout(300);
  return (await r.innerText().catch(() => '')) || '';
}
async function submit(page, url, button, name, pw) {
  await page.goto(L.BASE + url);
  await page.getByRole('textbox', { name: '用户名' }).fill(name);
  await page.getByLabel('密码').fill(pw);
  await page.getByRole('button', { name: button }).click();
  await page.waitForURL(/\/lobby/, { timeout: L.WAIT_MS }).catch(() => {});
}

write();
try {
  const name = L.uname('smk'), pw = 'Pw-' + L.RUN;
  const page = await L.newPage(null);
  await submit(page, '/register', '注册', name, pw);
  const t1 = /\/lobby/.test(page.url()) ? await info(page) : '';
  cp('注册后进入大厅，显示用户名、积分 1000、筹码 1000', t1.includes(`用户名：${name}`) && /积分：\s*1000(?!\d)/.test(t1) && /筹码：\s*1000(?!\d)/.test(t1), { url: page.url(), t1 });
  const page2 = await L.newPage(null);
  await submit(page2, '/login', '登录', name, pw);
  const t2 = /\/lobby/.test(page2.url()) ? await info(page2) : '';
  cp('新浏览器中用同一用户名与密码登录进入大厅', t2.includes(`用户名：${name}`), { url: page2.url(), t2 });
} catch (e) {
  cp('脚本执行异常', false, String(e && e.stack ? e.stack : e));
}
await L.closePages('smoke', false).catch(() => {});
await L.closeBrowser();
write();
process.exit(0);
