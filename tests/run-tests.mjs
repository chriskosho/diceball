// Serves the site locally, opens it in headless Chrome and:
//  1. runs the rules engine through the cases that matter (chart odds, base running, outs, walk-offs, extra innings, battles),
//  2. plays 300 whole games with random dice and checks they all finish correctly,
//  3. plays a computer against a computer through the interface,
//  4. plays a person's turns with animations on, including a battle and undo,
//  5. checks the Immersive 3D throw,
//  6. checks the installable app: manifest, service worker and offline reload,
//  7. checks updates: automatic reload that keeps the game, and the What's new window.
// Fails on any failed test, uncaught error or console error.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const appVersion = () => fs.readFileSync(path.join(root, 'index.html'), 'utf8').match(/APP_VERSION = '([^']+)'/)[1];
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  // The deploy step writes version.json; serve the same thing here.
  if (p === '/version.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ version: appVersion() })); return; }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const executablePath = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const problems = [];
const watch = page => {
  page.on('console', m => { if (m.type() === 'error') problems.push('console error: ' + m.text()); });
  page.on('pageerror', e => problems.push('page error: ' + e.message));
};
const fresh = async (opts = {}, init) => {
  const ctx = await browser.newContext(opts);
  // Close the Switch Sides screen on its own, except in the test that checks it.
  await ctx.addInitScript(() => { setInterval(() => { if (window.__keepSides) return; const b = document.querySelector('#sides[open] #sides-go'); if (b) b.click(); }, 80); });
  await ctx.addInitScript(() => { if (!localStorage.getItem('dd.roll')) localStorage.setItem('dd.roll', 'classic'); });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage(); watch(page); return { ctx, page };
};
const check = (cond, msg) => { if (!cond) problems.push(msg); };

// 1 and 2. Rules engine
{
  const { ctx, page } = await fresh();
  await page.goto(url);
  const result = await page.evaluate(() => {
    const E = __dd.engine, out = [];
    const T = (name, fn) => { try { const r = fn(); out.push({ name, pass: r === true || r === undefined, error: String(r) }); } catch (e) { out.push({ name, pass: false, error: e.message }); } };
    const game = (o = {}) => Object.assign(E.newGame({ teams: [{ name: 'A' }, { name: 'B' }] }), o);
    const play = (id, o = {}) => { const g = game(o); const ev = E.applyOutcome(g, id, false); return { g, ev }; };
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b) || ('expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));

    T('chart has all 21 pairs', () => { let n = 0; for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) { if (!E.CHART[a + '-' + b]) return 'missing ' + a + '-' + b; n++; } return n === 21 && Object.keys(E.CHART).length === 21; });
    T('chart odds add to 36 and match the printed chart', () => {
      const c = {}; for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) { const id = E.CHART[E.keyOf([a, b])]; c[id] = (c[id] || 0) + 1; }
      const want = { HR: 2, '2B': 4, '1B': 5, '3B': 2, BB: 3, HBP: 2, FO: 4, PO: 4, GO: 2, K: 6, DP: 1, TP: 1 };
      return eq(Object.keys(c).sort().map(k => [k, c[k]]), Object.keys(want).sort().map(k => [k, want[k]]));
    });
    T('single moves runners up one', () => { const { g, ev } = play('1B', { bases: [1, 1, 1] }); return ev.runs === 1 && eq(g.bases, [1, 1, 1]); });
    T('single with runner on second', () => { const { g, ev } = play('1B', { bases: [0, 1, 0] }); return ev.runs === 0 && eq(g.bases, [1, 0, 1]); });
    T('double moves runners up two', () => { const { g, ev } = play('2B', { bases: [1, 1, 1] }); return ev.runs === 2 && eq(g.bases, [0, 1, 1]); });
    T('double with runner on first goes to third', () => { const { g, ev } = play('2B', { bases: [1, 0, 0] }); return ev.runs === 0 && eq(g.bases, [0, 1, 1]); });
    T('triple scores every runner', () => { const { g, ev } = play('3B', { bases: [1, 1, 1] }); return ev.runs === 3 && eq(g.bases, [0, 0, 1]); });
    T('home run scores everyone plus the batter', () => { const { g, ev } = play('HR', { bases: [1, 1, 1] }); return ev.runs === 4 && eq(g.bases, [0, 0, 0]); });
    T('solo home run', () => { const { ev } = play('HR'); return ev.runs === 1; });
    T('walk with bases empty', () => { const { g, ev } = play('BB'); return ev.runs === 0 && eq(g.bases, [1, 0, 0]); });
    T('walk forces only forced runners (runner on first)', () => { const { g } = play('BB', { bases: [1, 0, 0] }); return eq(g.bases, [1, 1, 0]); });
    T('walk does not force a runner on third when first is open', () => { const { g, ev } = play('BB', { bases: [0, 0, 1] }); return ev.runs === 0 && eq(g.bases, [1, 0, 1]); });
    T('walk with first and third: second is empty so third stays', () => { const { g, ev } = play('BB', { bases: [1, 0, 1] }); return ev.runs === 0 && eq(g.bases, [1, 1, 1]); });
    T('walk with runners on second only does not force', () => { const { g } = play('HBP', { bases: [0, 1, 0] }); return eq(g.bases, [1, 1, 0]); });
    T('bases loaded walk forces in a run', () => { const { g, ev } = play('BB', { bases: [1, 1, 1] }); return ev.runs === 1 && eq(g.bases, [1, 1, 1]); });
    T('hit by pitch counts as a walk, not a hit', () => { const { g } = play('HBP'); return g.hits[0] === 0; });
    T('hits are counted', () => { const { g } = play('2B'); return g.hits[0] === 1; });
    T('outs do not move runners', () => { for (const id of ['FO', 'PO', 'GO', 'K', 'DP']) { const { g } = play(id, { bases: [1, 1, 0] }); if (JSON.stringify(g.bases) !== '[1,1,0]') return id + ' moved runners'; } return true; });
    T('one out adds one out', () => { const { g } = play('K'); return g.outs === 1; });
    T('double play adds two outs', () => { const { g } = play('DP'); return g.outs === 2; });
    T('double play with one out ends the half inning', () => { const { g, ev } = play('DP', { outs: 1, bases: [1, 0, 0] }); return ev.halfEnded && g.half === 1 && g.outs === 0 && eq(g.bases, [0, 0, 0]); });
    T('double play with two outs ends the half inning', () => { const { g, ev } = play('DP', { outs: 2 }); return ev.halfEnded && g.half === 1; });
    T('triple play ends the half inning from zero outs', () => { const { g, ev } = play('TP', { bases: [1, 1, 1] }); return ev.halfEnded && g.half === 1 && g.outs === 0 && eq(g.bases, [0, 0, 0]); });
    T('third out switches sides and clears bases', () => { const { g } = play('FO', { outs: 2, bases: [1, 1, 1] }); return g.half === 1 && g.inning === 1 && g.outs === 0 && eq(g.bases, [0, 0, 0]); });
    T('bottom half ending moves to the next inning', () => { const { g } = play('FO', { outs: 2, half: 1, inning: 3 }); return g.inning === 4 && g.half === 0; });
    T('runs go in the right inning and team', () => { const g = game({ inning: 3, half: 1 }); E.applyOutcome(g, 'HR', false); return g.runs[1][2] === 1 && E.teamRuns(g, 1) === 1 && E.teamRuns(g, 0) === 0; });
    T('home skips the bottom of the 9th when ahead', () => { const g = game({ inning: 9, half: 0, outs: 2, runs: [[], [1]] }); const ev = E.applyOutcome(g, 'K', false); return ev.over && g.over && g.winner === 1 && g.homeSkipped; });
    T('home bats the bottom of the 9th when behind', () => { const g = game({ inning: 9, half: 0, outs: 2, runs: [[0, 0, 0, 0, 0, 0, 0, 0, 2], [1]] }); const ev = E.applyOutcome(g, 'K', false); return !ev.over && g.half === 1; });
    T('home bats the bottom of the 9th when tied', () => { const g = game({ inning: 9, half: 0, outs: 2 }); const ev = E.applyOutcome(g, 'K', false); return !ev.over && g.half === 1; });
    T('walk-off ends the game at once', () => { const g = game({ inning: 9, half: 1, outs: 1, bases: [0, 0, 1], runs: [[0], []] }); const ev = E.applyOutcome(g, '1B', false); return ev.over && ev.walkoff && g.walkoff && g.winner === 1 && g.outs === 1; });
    T('no walk-off before the 9th', () => { const g = game({ inning: 8, half: 1, bases: [0, 0, 1] }); const ev = E.applyOutcome(g, '1B', false); return !ev.over; });
    T('tying run in the bottom of the 9th does not end it', () => { const g = game({ inning: 9, half: 1, bases: [0, 0, 1], runs: [[2], []] }); const ev = E.applyOutcome(g, '1B', false); return !ev.over && E.teamRuns(g, 1) === 1; });
    T('visitors win after the bottom of the 9th', () => { const g = game({ inning: 9, half: 1, outs: 2, runs: [[3], [1]] }); const ev = E.applyOutcome(g, 'K', false); return ev.over && g.winner === 0 && !g.homeSkipped; });
    T('tie after 9 goes to extra innings', () => { const g = game({ inning: 9, half: 1, outs: 2, runs: [[2], [2]] }); const ev = E.applyOutcome(g, 'K', false); return !ev.over && g.inning === 10 && g.half === 0; });
    T('extra innings: visitors lead after a full 10th wins', () => { const g = game({ inning: 10, half: 1, outs: 2, runs: [[2, 0, 0, 0, 0, 0, 0, 0, 0, 1], [2]] }); const ev = E.applyOutcome(g, 'K', false); return ev.over && g.winner === 0; });
    T('extra innings: home walk-off', () => { const g = game({ inning: 11, half: 1, bases: [1, 0, 0], runs: [[2], [2]] }); const ev = E.applyOutcome(g, 'HR', false); return ev.over && ev.walkoff && g.winner === 1; });
    T('shorter games use their own length', () => { const g = game({ innings: 3, inning: 3, half: 1, outs: 2, runs: [[1], [0]] }); const ev = E.applyOutcome(g, 'K', false); return ev.over && g.winner === 0; });
    T('good doubles start a battle', () => { const g = game(); const ev = E.atBat(g, [4, 4]); return ev.battle && g.pending.id === 'BB' && g.pending.b === null && g.outs === 0; });
    T('bad doubles do not', () => { const g = game(); const ev = E.atBat(g, [2, 2]); return !ev.battle && g.outs === 2; });
    T('only the four good doubles are battles', () => eq(E.BATTLE_KEYS, ['1-1', '4-4', '5-5', '6-6']));
    T('battle tie rolls again until broken', () => { const seq = [0.1, 0.1, 0.5, 0.5, 0.9, 0.2]; let i = 0; const r = E.battleRounds(() => seq[i++]); return eq(r, [[1, 1], [4, 4], [6, 2]]); });
    T('battle rounds end with a winner', () => { for (let i = 0; i < 500; i++) { const r = E.battleRounds(Math.random), l = r[r.length - 1]; if (l[0] === l[1]) return 'tied end'; if (r.slice(0, -1).some(x => x[0] !== x[1])) return 'continued past a win'; } return true; });
    T('batter wins the battle: result stands', () => { const g = game({ bases: [0, 0, 0] }); E.atBat(g, [1, 1]); const ev = E.resolveBattle(g, [[3, 3], [5, 2]]); return ev.batterWins && ev.id === 'HR' && ev.runs === 1 && g.pending === null && ev.rounds === 2; });
    T('defender wins the battle: it is an out', () => { const g = game({ bases: [1, 0, 0] }); E.atBat(g, [1, 1]); const ev = E.resolveBattle(g, [[2, 6]]); return !ev.batterWins && ev.label === 'Robbed Home Run' && ev.runs === 0 && g.outs === 1 && eq(g.bases, [1, 0, 0]) && g.hits[0] === 0; });
    T('robbed walk is a strikeout', () => { const g = game(); E.atBat(g, [4, 4]); const ev = E.resolveBattle(g, [[1, 5]]); return ev.label === 'Struck out looking' && g.outs === 1; });
    T('robbed third out ends the half inning', () => { const g = game({ outs: 2 }); E.atBat(g, [6, 6]); const ev = E.resolveBattle(g, [[1, 4]]); return ev.halfEnded && g.half === 1; });
    T('a battle walk-off home run wins the game', () => { const g = game({ inning: 9, half: 1, runs: [[0], []] }); E.atBat(g, [1, 1]); E.resolveBattle(g, [[6, 1]]); return g.over && g.walkoff && g.winner === 1; });

    T('moves: bases loaded double', () => { const { ev } = play('2B', { bases: [1, 1, 1] }); return eq(ev.moves, [{ from: 3, to: 4 }, { from: 2, to: 4 }, { from: 1, to: 3 }, { from: 0, to: 2 }]); });
    T('moves: walk with first and third only forces first', () => { const { ev } = play('BB', { bases: [1, 0, 1] }); return eq(ev.moves, [{ from: 1, to: 2 }, { from: 0, to: 1 }]); });
    T('moves: outs move nobody', () => { const { ev } = play('GO', { bases: [1, 1, 1] }); return eq(ev.moves, []); });
    T('moves: robbed hits move nobody', () => { const g = game({ bases: [1, 0, 0] }); E.atBat(g, [1, 1]); const ev = E.resolveBattle(g, [[1, 6]]); return eq(ev.moves, []); });
    T('moves agree with runs and bases', () => {
      for (let n = 0; n < 2000; n++) {
        const b = [0, 1, 2].map(() => Math.random() < .5 ? 1 : 0), ids = Object.keys(E.OUTCOMES), id = ids[n % ids.length];
        const g = game({ bases: b.slice() }); const ev = E.applyOutcome(g, id, false);
        if (ev.halfEnded) continue;
        const scored = ev.moves.filter(m => m.to === 4).length;
        if (scored !== ev.runs) return id + ' runs ' + ev.runs + ' vs moves ' + scored;
        const after = b.slice(); ev.moves.forEach(m => { if (m.from) after[m.from - 1] = 0; }); ev.moves.forEach(m => { if (m.to < 4) after[m.to - 1] = 1; });
        if (JSON.stringify(after) !== JSON.stringify(g.bases)) return id + ' ' + b + ' moved to ' + after + ' but bases are ' + g.bases;
      }
      return true;
    });
    // 300 whole games with random dice
    T('300 random games finish with the right winner', () => {
      for (let n = 0; n < 300; n++) {
        const g = E.newGame({ teams: [{ name: 'A' }, { name: 'B' }], innings: [3, 5, 9][n % 3] });
        let guard = 0;
        while (!g.over && guard++ < 5000) {
          const ev = E.atBat(g, E.roll2(Math.random));
          if (ev.battle) E.resolveBattle(g, E.battleRounds(Math.random));
          if (g.outs > 2 && !g.over) return 'outs stuck at ' + g.outs;
        }
        if (!g.over) return 'game did not end';
        const a = E.teamRuns(g, 0), b = E.teamRuns(g, 1);
        if (a === b) return 'tied at the end';
        if (g.winner !== (a > b ? 0 : 1)) return 'wrong winner';
        if (g.inning < g.innings) return 'ended early';
      }
      return true;
    });
    return out;
  });
  const failed = result.filter(r => !r.pass);
  for (const r of failed) problems.push(`FAILED ${r.name}: ${r.error}`);
  console.log(`Rule tests: ${result.length - failed.length} passed, ${failed.length} failed`);
  await ctx.close();
}

// 3. Computer against computer, through the interface, to the final out
{
  const { ctx, page } = await fresh({ viewport: { width: 420, height: 900 } }, () => { localStorage.setItem('dd.motion', 'off'); localStorage.setItem('dd.seen', '1.6.0'); });
  await page.goto(url);
  await page.waitForSelector('#setup[open]');
  await page.click('[data-pt="0"][data-bot="1"]');
  await page.click('[data-pt="1"][data-bot="1"]');
  await page.selectOption('select[name=innings]', '3');
  await page.click('#setup-form button[type=submit]');
  await page.waitForSelector('#over[open]', { timeout: 120000 });
  const txt = await page.innerText('#over-body');
  check(/win/.test(txt), 'computer game: no winner shown');
  check(await page.evaluate(() => __dd.state.over), 'computer game: state is not over');
  console.log('Computer game finished: ' + txt.split('\n').slice(0, 2).join(' | '));
  // Rematch starts a fresh game
  await page.click('#rematch');
  check(await page.evaluate(() => !__dd.state.over && __dd.state.inning === 1), 'rematch did not start a new game');
  await ctx.close();
}

// 4. A person's turns, with animations on, a battle and undo
{
  const { ctx, page } = await fresh({ viewport: { width: 420, height: 900 } }, () => { localStorage.setItem('dd.seen', '1.6.0'); });
  await page.goto(url);
  await page.waitForSelector('#setup[open]');
  await page.click('[data-pt="1"][data-bot="0"]');
  await page.click('#setup-form button[type=submit]');
  await page.waitForSelector('#app:not([hidden])');
  for (let i = 0; i < 3; i++) {
    await page.click('#rollbtn');
    await page.waitForFunction(() => !__dd.ui.busy && __dd.state.log.length > 0, null, { timeout: 15000 });
    await page.waitForTimeout(150);
  }
  const before = await page.evaluate(() => JSON.stringify(__dd.state));
  check(await page.evaluate(() => __dd.state.log.length >= 2), 'interface: rolls did not reach the log');
  check(await page.locator('#result b').count() > 0 || await page.evaluate(() => !!__dd.ui.result), 'interface: no result shown');
  await page.click('#undo');
  const after = await page.evaluate(() => JSON.stringify(__dd.state));
  check(before !== after, 'interface: undo changed nothing');
  // A home run plays out: ball over the wall, runners around the bases, play-by-play text
  await page.evaluate(() => { const s = __dd.state; s.bases = [1, 0, 0]; s.outs = 0; s.pending = { key: '1-1', id: 'HR', b: 6, rounds: [] }; renderAll(); });
  await page.evaluate(() => { window.__fxSeen = 0; new MutationObserver(() => { const n = document.querySelectorAll('#fx > g').length; if (n > window.__fxSeen) window.__fxSeen = n; }).observe(document.querySelector('#field'), { childList: true, subtree: true }); Math.__r = Math.random; let i = 0; Math.random = () => (i++ === 0 ? 0.01 : Math.__r()); });
  await page.click('#rollbtn');
  await page.waitForFunction(() => !__dd.ui.busy, null, { timeout: 15000 });
  await page.evaluate(() => { Math.random = Math.__r; });
  check(await page.evaluate(() => window.__fxSeen >= 2), 'animation: two runners did not run the bases');
  check(/homers/.test(await page.innerText('#result')), 'animation: no play-by-play line for the home run');
  await page.waitForTimeout(1200);
  check(await page.evaluate(() => document.querySelectorAll('#fx > *').length === 0), 'animation: leftover tokens on the field');
  check(await page.evaluate(() => !document.querySelector('#field').classList.contains('snap')), 'animation: field stuck without transitions');
  check((await page.locator('#chartbox .cc').count()) === 21, 'chart: expected 21 cells on screen');
  check((await page.locator('#chartbox .mdie').count()) === 42, 'chart: expected dice faces, two per roll');
  check((await page.locator('#chartbox .cc.now').count()) === 1, 'chart: the last roll was not highlighted');
  // Force a battle: the batter rolls a die, then the defender rolls theirs (ties roll again)
  await page.evaluate(() => { const s = __dd.state; s.pending = { key: '1-1', id: 'HR', b: null, rounds: [] }; s.outs = 0; s.bases = [0, 0, 0]; s.teams[0].bot = false; s.teams[1].bot = false; renderAll(); });
  check((await page.innerText('#rollbtn')) === 'Batter: roll your die', 'battle: first button should be the batter\'s die');
  const lab = await page.locator('.dlabel').allInnerTexts();
  check(lab.join('|') === 'Batter|Defender', 'battle: dice labels missing: ' + lab.join('|'));
  await page.click('#rollbtn');
  await page.waitForFunction(() => !__dd.ui.busy, null, { timeout: 15000 });
  check((await page.innerText('#rollbtn')) === 'Defender: roll your die', 'battle: second button should be the defender\'s die');
  check(await page.evaluate(() => __dd.state.pending.b >= 1 && __dd.state.log.length > 0), 'battle: batter die was not kept');
  for (let i = 0; i < 40 && await page.evaluate(() => !!__dd.state.pending); i++) {
    await page.click('#rollbtn');
    await page.waitForFunction(() => !__dd.ui.busy, null, { timeout: 15000 });
  }
  check(await page.evaluate(() => !__dd.state.pending), 'battle: did not resolve');
  // Three outs: Switch Sides waits for Continue so the device can be passed
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__keepSides = true; const s = __dd.state; s.pending = null; s.outs = 2; s.teams[0].bot = false; s.teams[1].bot = false; window.__half = s.half; renderAll(); Math.__r = Math.random; const seq = [0.2, 0.5]; Math.random = () => seq.length ? seq.shift() : Math.__r(); });
  await page.click('#rollbtn');
  await page.waitForFunction(() => !__dd.ui.busy, null, { timeout: 20000 });
  await page.evaluate(() => { Math.random = Math.__r; });
  await page.waitForSelector('#sides[open]');
  check(/Pass the device/.test(await page.innerText('#sides-body')), 'switch sides: no pass-the-device prompt');
  await page.waitForTimeout(2700);
  check(await page.evaluate(() => document.querySelector('#sides').open), 'switch sides: closed by itself in a two-player game');
  await page.click('#sides-go');
  check(await page.evaluate(() => !document.querySelector('#sides').open && __dd.state.half !== window.__half), 'switch sides: Continue did not hand over');
  await page.evaluate(() => { window.__keepSides = false; });
  console.log('Switch sides: waits for Continue, then hands over');
  // The sound and menu buttons use icons, and sound toggles the speaker
  check(await page.evaluate(() => !!document.querySelector('#snd svg') && !!document.querySelector('#gear svg')), 'toolbar: sound and menu should be icons');
  const on = await page.getAttribute('#snd-icon', 'd'); await page.click('#snd');
  check((await page.getAttribute('#snd-icon', 'd')) !== on && (await page.getAttribute('#snd', 'aria-pressed')) === 'false', 'toolbar: sound icon did not change when muted');
  await page.click('#snd');
  // Menu and chart open
  await page.click('#gear'); await page.waitForSelector('#menu[open]');
  await page.click('#m-chart'); await page.waitForSelector('#chartdlg[open]');
  check((await page.locator('#chartdlg tbody tr').count()) === 21, 'chart dialog: expected 21 rows');
  await page.keyboard.press('Escape');
  // Dark theme and log toggle
  await page.click('#gear'); await page.click('[data-set=theme][data-v=dark]'); await page.click('[data-set=log][data-v="1"]');
  check(await page.evaluate(() => document.documentElement.dataset.theme === 'dark'), 'dark theme did not apply');
  check(await page.isVisible('#log'), 'game log did not show');
  console.log('Interface test: rolls, undo, battle, chart and menu all worked');
  await ctx.close();
}

// 5. Immersive 3D throw
{
  const { ctx, page } = await fresh({ viewport: { width: 420, height: 900 } }, () => { localStorage.setItem('dd.roll', 'immersive'); localStorage.setItem('dd.seen', '1.6.0'); });
  await page.goto(url);
  await page.waitForSelector('#setup[open]');
  await page.click('[data-pt="1"][data-bot="0"]');
  await page.click('#setup-form button[type=submit]');
  await page.waitForSelector('#app:not([hidden])');
  await page.click('#rollbtn');
  await page.waitForSelector('#throw.armed');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => !document.querySelector('#throw') && !__dd.ui.busy, null, { timeout: 15000 });
  check(await page.evaluate(() => __dd.state.log.length > 0), 'immersive: the throw did not play the at-bat');
  // Cancel works
  await page.click('#rollbtn'); await page.waitForSelector('#throw.armed'); await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#throw'));
  // A battle throws one 3D die at a time
  await page.evaluate(() => { const s = __dd.state; s.pending = { key: '1-1', id: 'HR', b: null, rounds: [] }; s.teams[0].bot = false; s.teams[1].bot = false; renderAll(); });
  await page.click('#rollbtn'); await page.waitForSelector('#throw.armed');
  check((await page.locator('#throw .tdie').count()) === 1, 'immersive battle: expected a single die');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => !document.querySelector('#throw') && !__dd.ui.busy, null, { timeout: 15000 });
  check(await page.evaluate(() => __dd.state.pending && __dd.state.pending.b >= 1), 'immersive battle: batter die was not kept');
  console.log('Immersive throw: picked up, thrown, and put down');
  await ctx.close();
}

// Immersive is the default roll for a new player
{
  const { ctx, page } = await fresh({}, () => localStorage.removeItem('dd.roll'));
  await page.goto(url);
  check(await page.evaluate(() => __dd.ui.rollStyle === 'immersive'), 'Immersive should be the default dice roll');
  await ctx.close();
}

// 6. Installable app: manifest, service worker, offline
{
  const { ctx, page } = await fresh({ viewport: { width: 420, height: 900 } }, () => { localStorage.setItem('dd.seen', '1.6.0'); });
  await page.goto(url);
  const man = await (await page.request.get(url + 'manifest.webmanifest')).json();
  check(man.display === 'standalone' && man.icons.length >= 3, 'manifest incomplete');
  for (const i of man.icons) check((await page.request.get(url + i.src)).ok(), 'missing icon ' + i.src);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller || true);
  await page.reload(); await page.waitForTimeout(500);
  await ctx.setOffline(true);
  await page.reload();
  check(await page.evaluate(() => !!window.__dd), 'offline reload did not load the app');
  await ctx.setOffline(false);
  console.log('Installable app: manifest, icons and offline reload ok');
  await ctx.close();
}

// 7. Updates: automatic reload that keeps the game, then What's new
{
  const { ctx, page } = await fresh({ viewport: { width: 420, height: 900 } }, () => { if (!localStorage.getItem('dd.seen')) localStorage.setItem('dd.seen', '1.0.0'); });
  let served = appVersion();
  await page.route('**/version.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: served }) }));
  await page.goto(url);
  // A player from an older version sees What's new on opening
  await page.waitForSelector('#whatsnew[open]');
  check(/Cleaner big moments/.test(await page.innerText('#wn-body')), "What's new did not list the release");
  await page.click('#wn-close');
  await page.waitForSelector('#setup[open]');
  await page.click('[data-pt="1"][data-bot="0"]');
  await page.click('#setup-form button[type=submit]');
  await page.waitForSelector('#app:not([hidden])');
  await page.click('#rollbtn');
  await page.waitForFunction(() => !__dd.ui.busy && __dd.state.log.length > 1, null, { timeout: 15000 });
  const logLen = await page.evaluate(() => __dd.state.log.length);
  // A newer version appears on the site
  served = '9.9.9';
  await Promise.all([page.waitForEvent('load', { timeout: 20000 }), page.evaluate(() => checkForUpdate())]);
  await page.waitForFunction(() => window.__dd && __dd.state, null, { timeout: 10000 });
  check(await page.evaluate(n => __dd.state.log.length === n, logLen), 'update: the game was not kept');
  check(await page.isVisible('#app'), 'update: the game screen was not restored');
  check(await page.evaluate(() => !document.querySelector('#start[open]')), 'update: showed the Resume screen instead of resuming');
  // A normal reopen shows Resume and Start a new game
  served = appVersion();
  await page.evaluate(() => localStorage.removeItem('dd.resume'));
  await page.reload();
  await page.waitForSelector('#start[open]');
  check(/Resume game/.test(await page.innerText('#start-body')) && /Start a new game/.test(await page.innerText('#start-body')), 'reopen: no Resume / Start a new game');
  await page.click('#fresh'); await page.waitForSelector('#confirm[open]');
  check(/ends the game/.test(await page.innerText('#confirm-body')), 'reopen: no confirmation before ending a game');
  console.log('Updates: reload keeps the game, What’s new shows, reopen offers Resume');
  await ctx.close();
}

// Version bookkeeping
{
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const top = html.match(/RELEASES = \[\s*\{version:'([^']+)'/)[1];
  check(top === appVersion(), `APP_VERSION (${appVersion()}) does not match the newest RELEASES entry (${top})`);
}

await browser.close();
server.close();
if (problems.length) { console.error('\nProblems:\n - ' + [...new Set(problems)].join('\n - ')); process.exit(1); }
console.log('\nAll tests passed.');
