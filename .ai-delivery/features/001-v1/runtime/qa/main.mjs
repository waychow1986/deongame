// Runner: executes script scenarios in order, writes result contract v2 after every scenario.
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';
import { scenarios as authScenarios } from './scenarios/auth_rooms.mjs';
import { scenarios as chessScenarios } from './scenarios/chess.mjs';
import { scenarios as pokerScenarios } from './scenarios/poker.mjs';
import { scenarios as uiScenarios } from './scenarios/ui.mjs';

const started = Date.now();
const timeoutSec = Number(process.env.QA_TIMEOUT_SECONDS || 3000);
const deadline = started + timeoutSec * 1000 - 60000;
const resultPath = process.env.QA_RESULT_PATH || path.join(process.cwd(), 'result.json');
const only = (process.env.QA_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);

const all = [...authScenarios, ...chessScenarios, ...pokerScenarios, ...uiScenarios];
const results = [];
let usedDeps = false;

function write(summaryExtra = '') {
  const passed = results.filter((r) => r.passed).length;
  const out = {
    schemaVersion: 2,
    testedCommitSha: process.env.QA_CANDIDATE_SHA || '',
    summary: `DeonGame V1 独立测试：报告 ${results.length} 个场景，通过 ${passed}，未通过 ${results.length - passed}${summaryExtra}`,
    scenarios: results,
  };
  if (usedDeps) out.externalServices = ['postgres'];
  fs.writeFileSync(resultPath, JSON.stringify(out, null, 2));
}

write();
for (const s of all) {
  if (only.length && !only.includes(s.id)) continue;
  if (Date.now() > deadline - (s.budgetMs || 120000)) {
    console.log(`[skip] ${s.id}: not enough time left`);
    continue;
  }
  const ctx = {
    id: s.id,
    checkpoints: [],
    failed: false,
    cp(step, ok, observation) {
      const o = typeof observation === 'string' ? observation : JSON.stringify(observation);
      this.checkpoints.push({ step, passed: !!ok, observation: (o || '').slice(0, 1500) });
      if (!ok) this.failed = true;
      console.log(`  [${ok ? 'ok' : 'FAIL'}] ${s.id} ${step} :: ${(o || '').slice(0, 300)}`);
      return !!ok;
    },
    useDb() { usedDeps = true; },
  };
  L.netlog.lines = [];
  console.log(`[run] ${s.id}`);
  const t0 = Date.now();
  let unreportable = null;
  try {
    await s.fn(ctx);
  } catch (e) {
    if (e instanceof L.Unreportable) unreportable = e.message;
    else ctx.cp('脚本执行异常', false, String(e && e.stack ? e.stack : e));
  }
  const evidence = await L.closePages(s.id, ctx.failed || !!unreportable);
  try { await L.cleanupTracked(); } catch { /* ignore */ }
  if (ctx.failed || unreportable) {
    evidence.push(L.writeEvidence(`${s.id}-network.jsonl`, L.netlog.lines.join('\n')));
    evidence.push(L.writeEvidence(`${s.id}-checkpoints.json`, { checkpoints: ctx.checkpoints, unreportable }));
  }
  console.log(`[done] ${s.id} ${unreportable ? 'UNREPORTED: ' + unreportable : ctx.failed ? 'FAILED' : 'PASSED'} (${Math.round((Date.now() - t0) / 1000)}s)`);
  if (!unreportable) {
    results.push({ id: s.id, passed: !ctx.failed && ctx.checkpoints.length > 0, checkpoints: ctx.checkpoints, evidence });
  }
  write();
}
await L.closeBrowser();
await L.closeDb();
write();
console.log(`finished in ${Math.round((Date.now() - started) / 1000)}s`);
process.exit(0);
