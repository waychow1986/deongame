// Driver layer: HTTP client with cookie session, socket.io client, DB seeding, browser, result recording.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

export const req = createRequire(path.join(process.cwd(), 'noop.js'));
export const BASE = (process.env.AIDH_SERVICE_WEB_URL || '').replace(/\/$/, '');
export const RUN = 'q' + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 4);
export const EVIDENCE_DIR = process.env.QA_EVIDENCE_DIR || path.join(process.cwd(), 'evidence');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const WAIT_MS = 15000;
export const NEXT_HAND_WAIT_MS = 30000;

export class Unreportable extends Error {}

// ---------- network log (per scenario) ----------
export const netlog = { lines: [] };
export function logNet(entry) {
  if (netlog.lines.length < 3000) netlog.lines.push(JSON.stringify({ t: new Date().toISOString(), ...entry }));
}

let userSeq = 0;
export function uname(role) {
  userSeq += 1;
  return `qa_${RUN}_${role}${userSeq}`;
}

export class Client {
  constructor(label) {
    this.label = label;
    this.cookie = null;
    this.user = null;
    this.password = null;
  }
  async call(method, p, body, opts = {}) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    const cookie = opts.cookie !== undefined ? opts.cookie : this.cookie;
    if (cookie) headers.cookie = cookie;
    let r;
    for (let attempt = 0; ; attempt++) {
      try {
        r = await fetch(BASE + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
        break;
      } catch (e) {
        if (attempt >= 2) throw e;
        await sleep(500);
      }
    }
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    for (const c of sc) {
      const m = /^dg_session=([^;]*)/.exec(c);
      if (m && opts.cookie === undefined) this.cookie = `dg_session=${m[1]}`;
    }
    let j = null;
    const txt = await r.text();
    try { j = JSON.parse(txt); } catch { j = txt.slice(0, 300); }
    logNet({ who: this.label, method, path: p, body, status: r.status, resp: summarize(j) });
    return { status: r.status, body: j, code: j && j.error ? j.error.code : null, message: j && j.error ? j.error.message : null };
  }
  async register(username, password) {
    const r = await this.call('POST', '/api/auth/register', { username, password });
    if (r.status === 201) { this.user = r.body.user; this.password = password; }
    return r;
  }
  async login(username, password) {
    const r = await this.call('POST', '/api/auth/login', { username, password });
    if (r.status === 200) { this.user = r.body.user; this.password = password; }
    return r;
  }
  async me() { const r = await this.call('GET', '/api/me'); return r.status === 200 ? r.body.user : null; }
  async rooms() { const r = await this.call('GET', '/api/rooms'); return r.status === 200 ? r.body.rooms : null; }
  createRoom(game) { return this.call('POST', '/api/rooms', { game }); }
  createAi() { return this.call('POST', '/api/chess/ai-games', {}); }
  join(id) { return this.call('POST', `/api/rooms/${id}/join`, {}); }
  leave(id) { return this.call('POST', `/api/rooms/${id}/leave`, {}); }
  async state(id) { const r = await this.call('GET', `/api/rooms/${id}/state`); return r.status === 200 ? r.body.room : null; }
  move(id, from, to) { return this.call('POST', `/api/rooms/${id}/chess/move`, { from, to }); }
  resign(id) { return this.call('POST', `/api/rooms/${id}/chess/resign`, {}); }
  drawOffer(id) { return this.call('POST', `/api/rooms/${id}/chess/draw-offer`, {}); }
  drawResponse(id, accept) { return this.call('POST', `/api/rooms/${id}/chess/draw-response`, { accept }); }
  pokerStart(id) { return this.call('POST', `/api/rooms/${id}/poker/start`, {}); }
  addBot(id) { return this.call('POST', `/api/rooms/${id}/poker/bots`, {}); }
  act(id, type, amount) { return this.call('POST', `/api/rooms/${id}/poker/action`, amount === undefined ? { type } : { type, amount }); }
  async leaveCurrent() {
    const u = await this.me();
    if (u && u.currentRoomId) await this.leave(u.currentRoomId);
  }
}

function summarize(j) {
  const s = JSON.stringify(j);
  return s && s.length > 4000 ? s.slice(0, 4000) + '…' : j;
}

// Track clients created in a scenario for cleanup.
export const tracked = [];
export async function newUser(role, password = 'Pw-' + RUN) {
  const c = new Client(role);
  const r = await c.register(uname(role), password);
  if (r.status !== 201) throw new Error(`register failed for ${role}: ${r.status} ${JSON.stringify(r.body)}`);
  tracked.push(c);
  return c;
}
export async function cleanupTracked() {
  const list = tracked.splice(0);
  for (const c of list) { try { await c.leaveCurrent(); } catch { /* ignore */ } }
}

// ---------- polling ----------
export async function waitFor(fn, ms = WAIT_MS, interval = 300) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(interval);
  }
}
export async function mustWait(fn, what, ms = WAIT_MS) {
  const v = await waitFor(fn, ms);
  if (!v) throw new Unreportable(`wait limit reached: ${what}`);
  return v;
}

// ---------- socket.io ----------
export function connectSocket(cookie) {
  const { io } = req('socket.io-client');
  const extraHeaders = { origin: BASE };
  if (cookie) extraHeaders.cookie = cookie;
  const s = io(BASE, { path: '/socket.io/', transports: ['websocket', 'polling'], extraHeaders, reconnection: false, timeout: 10000, forceNew: true });
  const events = [];
  s.on('room:state', (st) => { events.push({ ev: 'room:state', st }); logNet({ who: 'socket', ev: 'room:state', version: st && st.version }); });
  s.on('room:closed', (x) => events.push({ ev: 'room:closed', x }));
  const ready = new Promise((resolve) => {
    s.on('connect', () => resolve({ ok: true }));
    s.on('connect_error', (e) => resolve({ ok: false, message: e && e.message }));
    setTimeout(() => resolve({ ok: false, message: 'timeout' }), 12000);
  });
  return { socket: s, events, ready, close: () => s.close() };
}

// ---------- DB seeding (only users.rating / users.chips_balance of test-created users) ----------
let pgClient = null;
export async function db() {
  if (pgClient) return pgClient;
  const { Client: PgClient } = req('pg');
  const [host, port] = (process.env.AIDH_DEP_POSTGRES_ADDRESS || process.env.AIDH_DEP_POSTGRES_ENDPOINT || '').split(':');
  const c = new PgClient({
    host, port: Number(port || 5432), user: process.env.AIDH_DEP_POSTGRES_USER,
    password: process.env.AIDH_DEP_POSTGRES_PASSWORD, database: process.env.AIDH_DEP_POSTGRES_DATABASE,
    ssl: process.env.AIDH_DEP_POSTGRES_SSLMODE && process.env.AIDH_DEP_POSTGRES_SSLMODE !== 'disable' ? { rejectUnauthorized: true } : false,
    connectionTimeoutMillis: 8000,
  });
  await c.connect();
  pgClient = c;
  return c;
}
export async function setUserValues(client, { rating, chips }) {
  if (!client.user || !client.user.username.startsWith(`qa_${RUN}_`)) throw new Error('refusing to modify non-test user');
  const c = await db();
  if (rating !== undefined) await c.query('update users set rating=$1 where id=$2 and username=$3', [rating, client.user.id, client.user.username]);
  if (chips !== undefined) await c.query('update users set chips_balance=$1 where id=$2 and username=$3', [chips, client.user.id, client.user.username]);
}
export async function closeDb() { if (pgClient) { try { await pgClient.end(); } catch { /* ignore */ } pgClient = null; } }

// ---------- browser ----------
let browser = null;
export async function getBrowser() {
  if (browser) return browser;
  const { chromium } = req('playwright-core');
  browser = await chromium.launch({ headless: true });
  return browser;
}
export async function closeBrowser() { if (browser) { try { await browser.close(); } catch { /* ignore */ } browser = null; } }
export const pages = [];
export async function newPage(client, opts = {}) {
  const b = await getBrowser();
  const ctxOpts = opts.mobile
    ? { viewport: { width: opts.width || 390, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' }
    : { viewport: { width: 1280, height: 900 } };
  const context = await b.newContext(ctxOpts);
  if (client && client.cookie) {
    const v = client.cookie.split('=').slice(1).join('=');
    await context.addCookies([{ name: 'dg_session', value: v, url: BASE }]);
  }
  const page = await context.newPage();
  const consoleLines = [];
  page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
  page.on('response', (r) => { if (r.url().includes('/api/')) logNet({ who: `browser:${client ? client.label : '-'}`, url: r.url(), status: r.status() }); });
  page.on('websocket', (ws) => ws.on('framereceived', (f) => { const p = String(f.payload); logNet({ who: 'browser-ws', frame: p.slice(0, 300) }); }));
  pages.push({ page, context, consoleLines, label: client ? client.label : 'anon' });
  return page;
}
export async function closePages(scenarioId, failed) {
  const list = pages.splice(0);
  let i = 0;
  const names = [];
  for (const p of list) {
    i += 1;
    if (failed) {
      try { const n = `${scenarioId}-page${i}-${p.label}.png`; await p.page.screenshot({ path: path.join(EVIDENCE_DIR, n), fullPage: true }); names.push(n); } catch { /* ignore */ }
      try { const n = `${scenarioId}-page${i}-console.log`; fs.writeFileSync(path.join(EVIDENCE_DIR, n), p.consoleLines.join('\n')); names.push(n); } catch { /* ignore */ }
    }
    try { await p.context.close(); } catch { /* ignore */ }
  }
  return names;
}
export async function noHorizontalScroll(page) {
  return page.evaluate(() => {
    const w = window.innerWidth;
    const sw = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
    return { ok: sw <= w + 1, innerWidth: w, scrollWidth: sw };
  });
}
// Lobby "我的信息" text through the UI
export async function lobbyInfoText(client) {
  const page = await newPage(client);
  await page.goto(BASE + '/lobby');
  const region = page.getByRole('region', { name: '我的信息' });
  await region.waitFor({ timeout: WAIT_MS });
  await page.waitForTimeout(500);
  return region.innerText();
}
export function writeEvidence(name, content) {
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  return name;
}
export function numText(n) { return n < 0 ? `-${Math.abs(n)}` : String(n); }
