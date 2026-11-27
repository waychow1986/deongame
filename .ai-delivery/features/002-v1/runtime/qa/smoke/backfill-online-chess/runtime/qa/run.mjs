// Runner: loads scenarios, runs lanes in parallel, honors QA_SCENARIOS, writes result v2 incrementally.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Ctx, closeBrowser, EVIDENCE_DIR, BASE } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULT = process.env.QA_RESULT_PATH || path.join(process.cwd(), 'qa-result.json');
const START = Date.now();
const TIMEOUT_S = Number(process.env.QA_TIMEOUT_SECONDS || 3600);
const DEADLINE = START + TIMEOUT_S * 1000 - 90_000;
const only = (process.env.QA_SCENARIOS || '').split(',').map((s) => s.trim()).filter(Boolean);

const all = [];
for (const f of fs.readdirSync(path.join(HERE, 'scenarios')).filter((f) => f.endsWith('.mjs')).sort()) {
  const mod = await import(pathToFileURL(path.join(HERE, 'scenarios', f)).href);
  for (const s of mod.scenarios || []) all.push(s);
}
const selected = all.filter((s) => !only.length || only.includes(s.id));
const results = [];

function write() {
  const order = all.map((s) => s.id);
  const scen = [...results].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const failed = scen.filter((s) => !s.passed).length;
  const out = {
    schemaVersion: 2,
    testedCommitSha: process.env.QA_CANDIDATE_SHA || '',
    summary: `${scen.length} scenarios reported, ${scen.length - failed} passed, ${failed} failed (of ${selected.length} selected) against ${BASE}`,
    scenarios: scen,
  };
  fs.mkdirSync(path.dirname(RESULT), { recursive: true });
  fs.writeFileSync(RESULT, JSON.stringify(out, null, 1));
}
write();

async function runOne(s) {
  const ctx = new Ctx(s.id);
  const t0 = Date.now();
  let error = null;
  const limitMs = (s.limitMinutes || 8) * 60_000;
  let timer;
  try {
    await Promise.race([
      s.run(ctx),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`scenario exceeded test wait limit ${s.limitMinutes || 8} min`)), limitMs); }),
    ]);
  } catch (e) {
    error = e;
  } finally {
    clearTimeout(timer);
  }
  await ctx.cleanup().catch(() => {});
  const logFile = `${s.id}-log.txt`;
  fs.writeFileSync(path.join(EVIDENCE_DIR, logFile), ctx.logs.join('\n') + (error ? `\nERROR: ${error.stack || error}` : ''));
  ctx.evidence.push(logFile);
  const secs = Math.round((Date.now() - t0) / 1000);
  if (error?.notReported || (error && /exceeded test wait limit/.test(error.message) && s.timeoutNotReported)) {
    console.log(`[${s.id}] not reported (${secs}s): ${error.message}`);
    return;
  }
  if (error) ctx.checkpoints.push({ step: '执行中断', passed: false, observation: String(error.message || error).slice(0, 800) });
  const passed = ctx.checkpoints.length > 0 && ctx.checkpoints.every((c) => c.passed);
  results.push({ id: s.id, passed, checkpoints: ctx.checkpoints, evidence: ctx.evidence });
  write();
  console.log(`[${s.id}] ${passed ? 'PASS' : 'FAIL'} (${secs}s)${passed ? '' : ' :: ' + ctx.checkpoints.filter((c) => !c.passed).map((c) => c.step + ': ' + c.observation).join(' | ').slice(0, 600)}`);
}

const lanes = {};
for (const s of selected) (lanes[s.group || 'A'] ||= []).push(s);
await Promise.all(Object.values(lanes).map(async (list) => {
  for (const s of list) {
    if (Date.now() + Math.min((s.limitMinutes || 8) * 60_000, 120_000) > DEADLINE) { console.log(`[${s.id}] skipped: deadline`); continue; }
    await runOne(s);
  }
}));
await closeBrowser();
write();
process.exit(0);
