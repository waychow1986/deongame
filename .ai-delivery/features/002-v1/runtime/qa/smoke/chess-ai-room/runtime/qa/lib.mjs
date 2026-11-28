// Shared driver layer: REST client with cookie jar, browser helpers, checkpoint recording.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const require = createRequire(path.join(process.env.QA_NODE_MODULES || path.join(process.cwd(), 'node_modules'), 'x.js'));
export const { chromium, devices } = require('playwright');

export const BASE = (process.env.AIDH_SERVICE_WEB_URL || '').replace(/\/$/, '');
export const RUN_ID = (process.env.QA_RUN_ID || crypto.randomBytes(3).toString('hex'));
export const EVIDENCE_DIR = process.env.QA_EVIDENCE_DIR || path.join(process.cwd(), 'evidence');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let userSeq = 0;
export function newUsername(tag = 'u') {
  userSeq += 1;
  return `qa_${RUN_ID}_${tag}${userSeq}_${crypto.randomBytes(2).toString('hex')}`.slice(0, 40);
}
export const newPassword = () => crypto.randomBytes(12).toString('base64url');

// ---------------- REST client ----------------
// Room snapshots carry `roomId`; list items carry `id`. Normalize so both have `id`.
const withId = (r) => (r && !r.id && r.roomId ? { ...r, id: r.roomId } : r);
export class Api {
  constructor(username, password) {
    this.username = username;
    this.password = password;
    this.cookie = null;
    this.user = null;
  }
  async req(method, p, body) {
    const headers = {};
    if (this.cookie) headers.cookie = `dg_session=${this.cookie}`;
    if (method !== 'GET') headers['content-type'] = 'application/json';
    let res;
    for (let i = 0; i < 3; i++) {
      try {
        res = await fetch(BASE + p, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
        break;
      } catch (e) {
        if (i === 2) throw e;
        await sleep(500);
      }
    }
    for (const sc of res.headers.getSetCookie?.() || []) {
      const m = /^dg_session=([^;]*)/.exec(sc);
      if (m) this.cookie = m[1] || null;
    }
    let data = null;
    const text = await res.text();
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data, code: data?.error?.code, message: data?.error?.message };
  }
  async must(method, p, body) {
    const r = await this.req(method, p, body);
    if (r.status >= 300) throw new Error(`${method} ${p} -> ${r.status} ${r.code || ''} ${r.message || ''}`);
    return r.data;
  }
  static async register(tag = 'u') {
    const a = new Api(newUsername(tag), newPassword());
    const d = await a.must('POST', '/api/auth/register', { username: a.username, password: a.password });
    a.user = d.user;
    return a;
  }
  async login() { const d = await this.must('POST', '/api/auth/login', { username: this.username, password: this.password }); this.user = d.user; return d; }
  async logout() { return this.req('POST', '/api/auth/logout', {}); }
  async me() { return (await this.must('GET', '/api/me')).user; }
  async rooms() { return (await this.must('GET', '/api/rooms')).rooms; }
  async createRoom(game, capacity) {
    const body = { game };
    if (capacity !== undefined) body.capacity = capacity;
    return withId((await this.must('POST', '/api/rooms', body)).room);
  }
  async aiGame() { return withId((await this.must('POST', '/api/chess/ai-games', {})).room); }
  async join(id) { return withId((await this.must('POST', `/api/rooms/${id}/join`, {})).room); }
  async leave(id) { return this.req('POST', `/api/rooms/${id}/leave`, {}); }
  async state(id) { return withId((await this.must('GET', `/api/rooms/${id}/state`)).room); }
  async move(id, from, to) { return this.req('POST', `/api/rooms/${id}/chess/move`, { from, to }); }
  async resign(id) { return this.req('POST', `/api/rooms/${id}/chess/resign`, {}); }
  async pokerStart(id) { return this.req('POST', `/api/rooms/${id}/poker/start`, {}); }
  async addBot(id) { return this.req('POST', `/api/rooms/${id}/poker/bots`, {}); }
  async action(id, type, amount) { const b = { type }; if (amount !== undefined) b.amount = amount; return this.req('POST', `/api/rooms/${id}/poker/action`, b); }
  // leave whatever room the user is in (cleanup)
  async leaveAll() {
    try {
      const me = await this.me();
      for (const id of [me.activeRoomId, me.currentRoomId]) if (id) await this.leave(id);
    } catch { /* ignore */ }
  }
}

// Wait until fn() returns truthy (polling). Returns value or null at timeout.
export async function waitFor(fn, { timeout = 60000, interval = 300 } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    await sleep(interval);
  }
  return null;
}

// ---------------- chess helpers ----------------
export const CHESS_NAMES = ['车', '马', '相', '象', '仕', '士', '帅', '将', '炮', '砲', '兵', '卒'];
// make a legal move for user via API following legalMoves; pick(from,to) filter optional
export async function apiChessMoveAny(api, roomId, filter = () => true) {
  const st = await api.state(roomId);
  const lm = st.chess?.legalMoves || {};
  const opts = [];
  for (const [f, tos] of Object.entries(lm)) for (const t of tos) if (filter(f, t, st)) opts.push([f, t]);
  if (!opts.length) return null;
  const [f, t] = opts[Math.floor(Math.random() * opts.length)];
  const r = await api.move(roomId, f, t);
  return r.status === 200 ? [f, t] : null;
}
export async function waitMyTurn(api, roomId, timeout = 60000) {
  return waitFor(async () => {
    const st = await api.state(roomId);
    if (st.chess?.status && st.chess.status !== 'active') return st;
    return st.chess?.turn === st.chess?.yourColor ? st : null;
  }, { timeout });
}
// Two users with an active online chess game. U1 red (host), U2 black.
export async function onlineChess() {
  const u1 = await Api.register('r');
  const u2 = await Api.register('b');
  const room = await u1.createRoom('chess');
  await u2.join(room.id);
  return { u1, u2, roomId: room.id };
}
// geometry: center of position in page coords
export async function boardGeom(page) {
  const board = page.getByRole('group', { name: '棋盘' });
  const box = await board.boundingBox();
  const orientation = await board.getAttribute('data-orientation');
  return { box, orientation };
}
export function posCenter(pos, g) {
  const col = pos.charCodeAt(0) - 97; const row = Number(pos[1]);
  const c = g.orientation === 'black-bottom' ? 8 - col : col;
  const r = g.orientation === 'black-bottom' ? row : 9 - row;
  return { x: g.box.x + (c + 0.5) * g.box.width / 9, y: g.box.y + (r + 0.5) * g.box.height / 10, c, r };
}
export const cell = (page, pos) => page.getByRole('button', { name: new RegExp(`^${pos} `) });
export async function waitBoardIdle(page, timeout = 60000) {
  try {
    await page.waitForFunction(() => {
      const b = document.querySelector('[role="group"][aria-label="棋盘"]') || [...document.querySelectorAll('[role="group"]')].find((e) => e.getAttribute('aria-label') === '棋盘');
      return b && b.getAttribute('data-anim') === 'idle';
    }, null, { timeout });
    return true;
  } catch { return false; }
}
export async function waitTableIdle(page, timeout = 60000) {
  try {
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('[role="region"],section')].find((e) => e.getAttribute('aria-label') === '牌桌');
      return b && b.getAttribute('data-anim') === 'idle';
    }, null, { timeout });
    return true;
  } catch { return false; }
}
export function parseRgb(s) {
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(s || '');
  return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
}
export const isRed = (c) => c && c.r - c.g > 80 && c.r - c.b > 80;

// ---------------- browser ----------------
let browserP = null;
export async function browser() {
  if (!browserP) browserP = chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  return browserP;
}
export async function closeBrowser() { if (browserP) { const b = await browserP; await b.close().catch(() => {}); browserP = null; } }

const SOUND_INIT = () => {
  window.__sounds = [];
  window.addEventListener('deongame:sound', (e) => { window.__sounds.push({ ...(e.detail || {}), t: Date.now() }); });
};

// Open a page logged in as api user (or anonymous if api null). opts: {device, viewport}
export async function openPage(ctx, api, opts = {}) {
  const b = await browser();
  const cOpts = opts.device ? { ...devices[opts.device] } : { viewport: opts.viewport || { width: 1280, height: 800 } };
  if (opts.device && opts.viewport) cOpts.viewport = opts.viewport;
  cOpts.locale = 'zh-CN';
  const context = await b.newContext(cOpts);
  if (api?.cookie) {
    const u = new URL(BASE);
    await context.addCookies([{ name: 'dg_session', value: api.cookie, domain: u.hostname, path: '/', httpOnly: true, secure: u.protocol === 'https:', sameSite: 'Lax' }]);
  }
  await context.addInitScript(SOUND_INIT);
  const page = await context.newPage();
  const label = api?.username?.split('_').slice(2, 3)[0] || 'anon';
  page.on('console', (m) => ctx.log(`[console ${label}] ${m.type()}: ${m.text()}`.slice(0, 500)));
  page.on('pageerror', (e) => ctx.log(`[pageerror ${label}] ${e.message}`.slice(0, 500)));
  page.on('response', async (r) => {
    const u = r.url();
    if (!u.includes('/api/')) return;
    let body = '';
    if (r.status() >= 400) { try { body = (await r.text()).slice(0, 300); } catch { /* */ } }
    ctx.log(`[net ${label}] ${r.request().method()} ${u.replace(BASE, '')} -> ${r.status()} ${body}`);
  });
  page.on('websocket', (ws) => {
    ws.on('framereceived', (f) => { const s = String(f.payload); if (s.length < 2000) ctx.log(`[ws< ${label}] ${s.slice(0, 300)}`); });
  });
  ctx.contexts.push(context);
  page.setDefaultTimeout(15000);
  return page;
}
export async function gotoLobby(page) {
  await page.goto(BASE + '/lobby');
  await page.getByRole('heading', { name: 'DeonGame' }).waitFor({ timeout: 20000 });
}
export async function gotoRoom(page, roomId) {
  await page.goto(BASE + '/room/' + roomId);
  await page.waitForURL(/\/room\//, { timeout: 15000 });
}
export async function sounds(page) { return page.evaluate(() => window.__sounds || []); }

// ---------------- scenario context ----------------
export class Ctx {
  constructor(id) {
    this.id = id;
    this.checkpoints = [];
    this.evidence = [];
    this.logs = [];
    this.contexts = [];
    this.apis = [];
    this.unreported = false;
  }
  log(s) { if (this.logs.length < 3000) this.logs.push(`${new Date().toISOString()} ${s}`); }
  check(step, passed, observation = '') {
    this.checkpoints.push({ step, passed: !!passed, observation: String(observation).slice(0, 800) });
    this.log(`CHECK ${passed ? 'PASS' : 'FAIL'} ${step} :: ${observation}`);
    return !!passed;
  }
  // mark scenario as not reportable (test wait limit reached)
  notReported(reason) { this.unreported = true; this.log(`NOT REPORTED: ${reason}`); const e = new Error('NOT_REPORTED: ' + reason); e.notReported = true; throw e; }
  async shot(page, name) {
    const f = `${this.id}-${name}.png`.replace(/[^\w.-]/g, '_');
    try { await page.screenshot({ path: path.join(EVIDENCE_DIR, f), fullPage: false }); this.evidence.push(f); } catch { /* */ }
    return f;
  }
  saveJson(name, data) {
    const f = `${this.id}-${name}.json`.replace(/[^\w.-]/g, '_');
    fs.writeFileSync(path.join(EVIDENCE_DIR, f), JSON.stringify(data, null, 2).slice(0, 2_000_000));
    this.evidence.push(f);
  }
  async reg(tag) { const a = await Api.register(tag); this.apis.push(a); return a; }
  track(api) { this.apis.push(api); return api; }
  async cleanup() {
    for (const c of this.contexts) await c.close().catch(() => {});
    for (const a of this.apis) await a.leaveAll();
  }
}
