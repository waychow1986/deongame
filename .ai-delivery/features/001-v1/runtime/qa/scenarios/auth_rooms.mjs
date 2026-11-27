// TS-01 ~ TS-10: accounts, auth guard, lobby and rooms.
import * as L from '../lib.mjs';

const { BASE } = L;
const findRoom = (rooms, id) => (rooms || []).find((r) => r.id === id);

async function uiRegister(page, username, password) {
  await page.goto(BASE + '/register');
  await page.getByRole('textbox', { name: '用户名' }).fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '注册' }).click();
}
async function uiLogin(page, username, password) {
  await page.goto(BASE + '/login');
  await page.getByRole('textbox', { name: '用户名' }).fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
}
async function lobbyInfo(page) {
  const region = page.getByRole('region', { name: '我的信息' });
  await region.waitFor({ timeout: L.WAIT_MS });
  await page.waitForTimeout(300);
  return region.innerText();
}
async function alertText(page) {
  const a = page.getByRole('alert');
  try { await a.first().waitFor({ timeout: 8000 }); } catch { return ''; }
  return (await a.allInnerTexts()).join(' | ');
}
const atLogin = (page) => /\/login(\b|$|\?)/.test(new URL(page.url()).pathname);

export const scenarios = [
  {
    id: 'TS-01',
    async fn(ctx) {
      const name = L.uname('a');
      const pw = 'Pw1-' + L.RUN;
      const page = await L.newPage(null);
      await uiRegister(page, name, pw);
      await page.waitForURL(/\/lobby/, { timeout: L.WAIT_MS }).catch(() => {});
      const inLobby = /\/lobby/.test(page.url());
      ctx.cp('注册后进入大厅', inLobby, page.url());
      const info = inLobby ? await lobbyInfo(page) : '';
      ctx.cp('大厅显示用户名、积分 1000、筹码 1000', info.includes(`用户名：${name}`) && /积分：\s*1000\b/.test(info) && /筹码：\s*1000\b/.test(info), info);
      const page2 = await L.newPage(null);
      await uiLogin(page2, name, pw);
      await page2.waitForURL(/\/lobby/, { timeout: L.WAIT_MS }).catch(() => {});
      const info2 = /\/lobby/.test(page2.url()) ? await lobbyInfo(page2) : '';
      ctx.cp('无登录状态的新浏览器中用同一用户名与密码登录进入大厅', info2.includes(`用户名：${name}`), `${page2.url()} ${info2}`);
    },
  },
  {
    id: 'TS-02',
    async fn(ctx) {
      const dup = L.uname('dup');
      const P1 = 'P1-' + L.RUN, P2 = 'P2-' + L.RUN;
      const orig = new L.Client('dup');
      await orig.register(dup, P1);
      const page = await L.newPage(null);
      await uiRegister(page, dup, P2);
      const al = await alertText(page);
      ctx.cp('1 重名注册页面显示“用户名已被占用”', al.includes('用户名已被占用') && !/\/lobby/.test(page.url()), `${al} @ ${page.url()}`);
      const api = await new L.Client('x').register(dup, P2);
      ctx.cp('1 重名注册接口被拒绝 USERNAME_TAKEN', api.status === 409 && api.code === 'USERNAME_TAKEN', api);
      const l1 = await new L.Client('x').login(dup, P1);
      const l2 = await new L.Client('x').login(dup, P2);
      ctx.cp('1 原密码 P1 登录成功、P2 登录失败，原账号积分与筹码不变', l1.status === 200 && l2.status !== 200 && l1.body.user.rating === 1000 && l1.body.user.chips === 1000, { l1: l1.status, l2: l2.status, user: l1.body && l1.body.user });

      const onlyPw = 'OnlyPw-' + L.RUN;
      const eName = L.uname('e');
      const r1 = await new L.Client('x').register('', onlyPw);
      const r2 = await new L.Client('x').register(eName, '');
      const r3 = await new L.Client('x').register('', '');
      const r4 = await new L.Client('x').register('   ', onlyPw);
      ctx.cp('2 用户名空/密码空/两者都空被拒绝并提示必填', [r1, r2, r3, r4].every((r) => r.status === 400 && /必填/.test(r.message || '')), [r1, r2, r3, r4].map((r) => `${r.status} ${r.message}`));
      const page2 = await L.newPage(null);
      await page2.goto(BASE + '/register');
      await page2.getByRole('button', { name: '注册' }).click();
      const al2 = await alertText(page2);
      ctx.cp('2 页面空表单提交提示必填', /必填/.test(al2) && !/\/lobby/.test(page2.url()), al2);
      const lpw = await new L.Client('x').login('', onlyPw);
      const lpw2 = await new L.Client('x').login(dup, onlyPw);
      const le = await new L.Client('x').login(eName, '');
      const le2 = await new L.Client('x').login(eName, 'anything');
      const re = await new L.Client('x').register(eName, 'E-' + L.RUN);
      ctx.cp('2 被拒的注册没有生成账号（登录失败，之后可用该用户名注册）', lpw.status !== 200 && lpw2.status !== 200 && le.status !== 200 && le2.status !== 200 && re.status === 201, [lpw.status, lpw2.status, le.status, le2.status, re.status]);

      const upper = dup.replace(/^qa_/, 'QA_').toUpperCase();
      const ru = await new L.Client('x').register(upper, P2);
      ctx.cp('3 仅大小写不同的用户名可注册，为独立账号（积分 1000、筹码 1000）', ru.status === 201 && ru.body.user.id !== l1.body.user.id && ru.body.user.rating === 1000 && ru.body.user.chips === 1000, ru);
      const l3 = await new L.Client('x').login(dup, P1);
      ctx.cp('3 原账号仍用 P1 登录', l3.status === 200 && l3.body.user.id === l1.body.user.id, l3.status);

      const cname = L.uname('conc');
      const [a, b] = await Promise.all([new L.Client('c1').register(cname, 'CA-' + L.RUN), new L.Client('c2').register(cname, 'CB-' + L.RUN)]);
      const okA = a.status === 201, okB = b.status === 201;
      const loser = okA ? b : a;
      ctx.cp('4 并发同名注册恰好一个成功，另一个“用户名已被占用”', okA !== okB && loser.status === 409 && loser.message === '用户名已被占用', [a.status, b.status, loser.message]);
      const la = await new L.Client('x').login(cname, 'CA-' + L.RUN);
      const lb = await new L.Client('x').login(cname, 'CB-' + L.RUN);
      ctx.cp('4 只能用成功一方的密码登录', okA ? la.status === 200 && lb.status !== 200 : lb.status === 200 && la.status !== 200, [la.status, lb.status]);
    },
  },
  {
    id: 'TS-03',
    async fn(ctx) {
      const u = await L.newUser('b');
      const name = u.user.username, pw = u.password;
      const p = await L.newPage(null);
      await uiLogin(p, name, pw);
      await p.waitForURL(/\/lobby/, { timeout: L.WAIT_MS }).catch(() => {});
      const info = /\/lobby/.test(p.url()) ? await lobbyInfo(p) : '';
      ctx.cp('1 正确凭据进入大厅并显示用户名、积分、筹码', info.includes(`用户名：${name}`) && /积分：/.test(info) && /筹码：/.test(info), info);
      const cases = [
        ['2 密码错误', name, pw + 'x'],
        ['3 用户名不存在', L.uname('nouser'), pw],
        ['4 用户名大小写不同', name.toUpperCase(), pw],
      ];
      for (const [label, un, pwd] of cases) {
        const pg = await L.newPage(null);
        await uiLogin(pg, un, pwd);
        const al = await alertText(pg);
        await pg.waitForTimeout(500);
        const stillLogin = atLogin(pg);
        await pg.goto(BASE + '/lobby');
        await pg.waitForURL(/\/login/, { timeout: 8000 }).catch(() => {});
        const api = await new L.Client('x').login(un, pwd);
        ctx.cp(`${label}：显示“用户名或密码错误”，不进入大厅`, al.includes('用户名或密码错误') && stillLogin && atLogin(pg) && api.status === 401 && api.message === '用户名或密码错误', { alert: al, stillLogin, afterLobby: pg.url(), api: [api.status, api.message] });
      }
    },
  },
  {
    id: 'TS-04',
    async fn(ctx) {
      const u = await L.newUser('own');
      const r = await u.createRoom('chess');
      const id = r.body && r.body.room && r.body.room.roomId;
      ctx.cp('前置：已存在房间', !!id, r.status);
      for (const target of ['/lobby', `/room/${id}`]) {
        const p = await L.newPage(null);
        await p.goto(BASE + target);
        await p.waitForURL(/\/login/, { timeout: L.WAIT_MS }).catch(() => {});
        const lobbyHeading = await p.getByRole('heading', { name: '游戏大厅' }).count();
        const roomHeading = await p.getByRole('heading', { name: '中国象棋房间' }).count();
        ctx.cp(`未登录打开 ${target.replace(id, '<id>')} 被引导到登录页且看不到内容`, atLogin(p) && lobbyHeading === 0 && roomHeading === 0, p.url());
      }
    },
  },
  {
    id: 'TS-05',
    async fn(ctx) {
      const u1 = await L.newUser('u1'), u2 = await L.newUser('u2'), u3 = await L.newUser('u3');
      const cr = await u1.createRoom('chess');
      const cid = cr.body.room.roomId;
      await u2.join(cid);
      const pr = await u3.createRoom('poker');
      const pid = pr.body.room.roomId;
      const before = await u1.state(cid);
      const pBefore = await u3.state(pid);
      const me1 = await u1.me();
      const anon = new L.Client('anon');
      const forged = 'dg_session=forged' + L.RUN + 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      for (const [label, cookie] of [['不带凭证', ''], ['伪造凭证', forged]]) {
        const calls = [
          ['查看大厅', 'GET', '/api/rooms'],
          ['当前用户', 'GET', '/api/me'],
          ['创建房间', 'POST', '/api/rooms', { game: 'chess' }],
          ['人机对局', 'POST', '/api/chess/ai-games', {}],
          ['加入房间', 'POST', `/api/rooms/${pid}/join`, {}],
          ['离开房间', 'POST', `/api/rooms/${cid}/leave`, {}],
          ['查看房间状态', 'GET', `/api/rooms/${cid}/state`],
          ['走棋', 'POST', `/api/rooms/${cid}/chess/move`, { from: 'a3', to: 'a4' }],
          ['提和', 'POST', `/api/rooms/${cid}/chess/draw-offer`, {}],
          ['认输', 'POST', `/api/rooms/${cid}/chess/resign`, {}],
          ['开始一手', 'POST', `/api/rooms/${pid}/poker/start`, {}],
          ['扑克行动', 'POST', `/api/rooms/${pid}/poker/action`, { type: 'fold' }],
          ['添加电脑玩家', 'POST', `/api/rooms/${pid}/poker/bots`, {}],
        ];
        const bad = [];
        for (const [n, m, p, b] of calls) {
          const r = await anon.call(m, p, b, { cookie });
          if (!(r.status === 401 && r.code === 'UNAUTHENTICATED')) bad.push(`${n}:${r.status}:${r.code}`);
        }
        ctx.cp(`${label}调用各项操作都返回未登录`, bad.length === 0, bad.length ? bad : 'all 401 UNAUTHENTICATED');
        const s = L.connectSocket(cookie || null);
        const rd = await s.ready;
        await L.sleep(800);
        const got = s.events.length;
        s.close();
        ctx.cp(`${label}建立实时连接失败`, !rd.ok && got === 0, rd);
      }
      const after = await u1.state(cid);
      const pAfter = await u3.state(pid);
      const me1b = await u1.me();
      const same = JSON.stringify(after.chess.board) === JSON.stringify(before.chess.board) && after.chess.turn === before.chess.turn
        && after.chess.status === 'active' && after.members.length === 2 && pAfter.members.length === pBefore.members.length
        && (pAfter.poker.stage === pBefore.poker.stage) && me1b.rating === me1.rating;
      ctx.cp('房间成员、棋盘、轮次、积分都没有变化', same, { turn: after.chess.turn, members: after.members.length, pokerMembers: pAfter.members.length, rating: me1b.rating });
      const ok = await u1.rooms();
      ctx.cp('对照：登录后查看大厅正常', Array.isArray(ok), ok ? ok.length : null);
      const sock = L.connectSocket(u1.cookie);
      const rd = await sock.ready;
      sock.close();
      ctx.cp('对照：登录后实时连接可建立', rd.ok, rd);
    },
  },
  {
    id: 'TS-06',
    async fn(ctx) {
      const u1 = await L.newUser('h1'), u2 = await L.newUser('h2'), u3 = await L.newUser('v3');
      const c = await u1.createRoom('chess');
      const p = await u2.createRoom('poker');
      ctx.cp('U1、U2 创建房间成功并进入房间', c.status === 201 && p.status === 201 && (await u1.me()).currentRoomId === c.body.room.roomId && (await u2.me()).currentRoomId === p.body.room.roomId, [c.status, p.status]);
      const rooms = await u3.rooms();
      const rc = findRoom(rooms, c.body.room.roomId), rp = findRoom(rooms, p.body.room.roomId);
      ctx.cp('列表接口含两房间：类型、房主、人数 1/2 与 1/9、可加入', rc && rp && rc.game === 'chess' && rp.game === 'poker' && rc.hostUsername === u1.user.username && rp.hostUsername === u2.user.username
        && rc.players === 1 && rc.capacity === 2 && rp.players === 1 && rp.capacity === 9 && !rc.full && !rp.full, { rc, rp });
      const page = await L.newPage(u3);
      await page.goto(BASE + '/lobby');
      await page.getByRole('button', { name: '刷新房间列表' }).click().catch(() => {});
      const table = page.getByRole('table', { name: '房间列表' });
      await table.waitFor({ timeout: L.WAIT_MS }).catch(() => {});
      const rowC = table.getByRole('row').filter({ hasText: u1.user.username });
      const rowP = table.getByRole('row').filter({ hasText: u2.user.username });
      await rowC.first().waitFor({ timeout: L.WAIT_MS }).catch(() => {});
      const tc = (await rowC.count()) ? await rowC.first().innerText() : '';
      const tp = (await rowP.count()) ? await rowP.first().innerText() : '';
      const jc = (await rowC.count()) ? await rowC.first().getByRole('button', { name: '加入' }).count() : 0;
      const jp = (await rowP.count()) ? await rowP.first().getByRole('button', { name: '加入' }).count() : 0;
      ctx.cp('U3 大厅页面显示两房间类型、房主、人数与可加入', tc.includes('中国象棋') && tc.includes('1/2') && tc.includes('可加入') && tp.includes('德州扑克') && tp.includes('1/9') && tp.includes('可加入') && jc === 1 && jp === 1, { tc, tp, jc, jp });
      const again = await u1.createRoom('poker');
      const again2 = await u1.createRoom('chess');
      const rooms2 = await u3.rooms();
      const mine = rooms2.filter((r) => r.hostUsername === u1.user.username);
      ctx.cp('对照：U1 在房间中再创建房间被拒绝，列表中 U1 只有一个房间', again.status === 409 && again.code === 'ALREADY_IN_ROOM' && again2.status === 409 && mine.length === 1, [again.status, again.code, again2.status, mine.length]);
    },
  },
  {
    id: 'TS-07',
    async fn(ctx) {
      const u1 = await L.newUser('r1'), u2 = await L.newUser('r2'), u3 = await L.newUser('r3');
      const id = (await u1.createRoom('chess')).body.room.roomId;
      const j = await u2.join(id);
      const s1 = await u1.state(id), s2 = await u2.state(id);
      ctx.cp('1 U2 加入后对局自动开始，U1 执红先走，U2 执黑', j.status === 200 && s1.chess.status === 'active' && s1.chess.players.red.userId === u1.user.id && s1.chess.players.black.userId === u2.user.id
        && s1.chess.turn === 'red' && s1.chess.yourColor === 'red' && s2.chess.yourColor === 'black' && s1.members.length === 2, { status: s1.chess.status, players: s1.chess.players, turn: s1.chess.turn });
      const r = findRoom(await u3.rooms(), id);
      ctx.cp('2 大厅接口显示 2/2 已满', r && r.players === 2 && r.full === true, r);
      const page = await L.newPage(u3);
      await page.goto(BASE + '/lobby');
      const row = page.getByRole('table', { name: '房间列表' }).getByRole('row').filter({ hasText: u1.user.username });
      await row.first().waitFor({ timeout: L.WAIT_MS }).catch(() => {});
      const t = (await row.count()) ? await row.first().innerText() : '';
      const jb = (await row.count()) ? await row.first().getByRole('button', { name: '加入' }).count() : -1;
      ctx.cp('2 大厅页面显示 2/2、已满，不提供加入', t.includes('2/2') && t.includes('已满') && jb === 0, { t, jb });
      const j3 = await u3.join(id);
      const s3 = await u1.state(id);
      ctx.cp('3 U3 直接加入被拒绝“房间已满”，成员仍为 U1、U2', j3.status === 409 && j3.message === '房间已满' && s3.members.length === 2 && s3.members.every((m) => [u1.user.id, u2.user.id].includes(m.userId)), [j3.status, j3.message, s3.members]);
      const p3 = await L.newPage(u3);
      await p3.goto(BASE + `/room/${id}`);
      await p3.waitForTimeout(1500);
      const s4 = await u1.state(id);
      ctx.cp('3 U3 通过房间地址打开后成员仍为 2 人', s4.members.length === 2, s4.members.length);
    },
  },
  {
    id: 'TS-08',
    async fn(ctx) {
      const u1 = await L.newUser('s1'), u2 = await L.newUser('s2'), u3 = await L.newUser('s3');
      const id = (await u1.createRoom('chess')).body.room.roomId;
      const [a, b] = await Promise.all([u2.join(id), u3.join(id)]);
      const st = await u1.state(id);
      const okCount = [a, b].filter((r) => r.status === 200).length;
      const loser = a.status === 200 ? b : a;
      ctx.cp('恰好一人加入成功，另一人看到“房间已满”', okCount === 1 && loser.status === 409 && loser.message === '房间已满', [a.status, b.status, loser.message]);
      ctx.cp('房间成员 2 人，对局只开始一局', st.members.length === 2 && st.chess.status === 'active' && st.chess.turn === 'red' && st.chess.board.length === 32, { members: st.members.length, status: st.chess.status, gameId: st.chess.gameId });
      const s2 = await (a.status === 200 ? u2 : u3).state(id);
      ctx.cp('成功加入者看到的对局与房主相同', s2 && s2.chess.gameId === st.chess.gameId, s2 && s2.chess.gameId);
    },
  },
  {
    id: 'TS-09',
    async fn(ctx) {
      const u1 = await L.newUser('p1'), u2 = await L.newUser('p2'), u3 = await L.newUser('p3');
      const id = (await u1.createRoom('poker')).body.room.roomId;
      const adds = [];
      for (let i = 0; i < 7; i++) adds.push((await u1.addBot(id)).status);
      const r8 = findRoom(await u2.rooms(), id);
      ctx.cp('添加 7 个电脑玩家后大厅显示 8/9 可加入', adds.every((s) => s === 201) && r8 && r8.players === 8 && r8.capacity === 9 && !r8.full, { adds, r8 });
      const j2 = await u2.join(id);
      const r9 = findRoom(await u3.rooms(), id);
      ctx.cp('U2 加入第 9 座后显示 9/9 已满', j2.status === 200 && r9 && r9.players === 9 && r9.full === true, { j: j2.status, r9 });
      const before = await u1.state(id);
      const j3 = await u3.join(id);
      const after = await u1.state(id);
      ctx.cp('U3 加入被拒绝“房间已满”，成员不变', j3.status === 409 && j3.message === '房间已满' && after.members.length === before.members.length && after.poker.seats.length === 9, [j3.status, j3.message, after.poker.seats.length]);
      const b = await u1.addBot(id);
      const after2 = await u1.state(id);
      ctx.cp('满员后 U1 再添加电脑玩家被拒绝', b.status >= 400 && after2.poker.seats.length === 9, [b.status, b.code, b.message]);
    },
  },
  {
    id: 'TS-10',
    async fn(ctx) {
      const u1 = await L.newUser('m1'), u2 = await L.newUser('m2'), u3 = await L.newUser('m3'), u4 = await L.newUser('m4');
      const id = (await u1.createRoom('poker')).body.room.roomId;
      await u2.join(id); await u3.join(id); await u1.addBot(id);
      const cid = (await u4.createRoom('chess')).body.room.roomId;
      const ja = await u2.join(cid), jb = await u2.createRoom('chess');
      const me2 = await u2.me();
      ctx.cp('1 U2 加入他人房间或新建房间被拒绝，仍在原房间', ja.status === 409 && ja.code === 'ALREADY_IN_ROOM' && jb.status === 409 && me2.currentRoomId === id, [ja.status, ja.code, jb.status, me2.currentRoomId === id]);
      const before = findRoom(await u4.rooms(), id);
      const l1 = await u1.leave(id);
      const me1 = await u1.me();
      const st = await u2.state(id);
      const after = findRoom(await u4.rooms(), id);
      ctx.cp('2 U1 离开回到大厅，房主移交 U2，人数减 1', l1.status === 200 && me1.currentRoomId === null && st.hostUserId === u2.user.id && after && after.hostUsername === u2.user.username && after.players === before.players - 1, { before, after, host: st.hostUserId === u2.user.id });
      const n1 = await u1.createRoom('chess');
      ctx.cp('3 U1 离开后可以新建其他房间', n1.status === 201, n1.status);
      if (n1.status === 201) await u1.leave(n1.body.room.roomId);
      await u2.leave(id); await u3.leave(id);
      const gone = !findRoom(await u4.rooms(), id);
      const st2 = await u4.call('GET', `/api/rooms/${id}/state`);
      ctx.cp('4 真人都离开后房间关闭、从列表消失', gone && st2.status !== 200, { gone, state: st2.status });
      await u4.leave(cid);
      ctx.cp('5 U4 离开只有自己的象棋房间后房间从列表消失', !findRoom(await u1.rooms(), cid), 'checked');
    },
  },
];
