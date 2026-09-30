/* Everything around a run: directives, the lottery, the secret comrade, the
 * roster, the game-over card and the save file. */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openGame, closeBrowser } = require('./helpers');

test.after(closeBrowser);

const BASE_SAVE = { best: 0, coins: 0, runs: 0, owned: ['mittens', 'biscuit'], char: 'mittens' };

function withSave(extra) { return Object.assign({}, BASE_SAVE, extra); }

/* Kill the current run and let the game-over card come up. */
async function dieAs(a, kind) {
  await a.eval((k) => {
    const g = PP.Game.g;
    g.player.dead = true; g.player.deathKind = k; g.mode = 'dying'; g.deathT = 99;
  }, kind);
  await a.step(3);
}

test('a fresh save starts with two comrades and three distinct directives', async () => {
  const a = await openGame({ seed: 31 });
  const s = await a.eval(() => ({
    owned: PP.Game.save.owned.slice(),
    ids: PP.Game.save.directives.map(d => d.id),
    rows: document.querySelectorAll('#directives .drow').length
  }));
  assert.deepEqual(s.owned, ['mittens', 'biscuit']);
  assert.equal(new Set(s.ids).size, 3);
  assert.equal(s.rows, 3);
  assert.deepEqual(a.errors, []);
  await a.close();
});

test('a directive pays its bounty the moment it is met, once', async () => {
  const a = await openGame({ seed: 32, save: withSave({ directives: [
    { id: 'coins15', done: false }, { id: 'hops500', done: false }, { id: 'ice3', done: false }
  ] }) });
  await a.page.click('#btn-play');
  await a.step(2);
  const before = await a.eval(() => {
    const g = PP.Game.g, W = PP.World;
    for (let i = 0; i < 200; i++) {
      if (W.row(i).type !== 'grass' || W.row(i + 1).type !== 'grass' || W.row(i + 2).type !== 'grass') continue;
      if (W.isBlocked(0, i) || W.isBlocked(0, i + 1) || W.isBlocked(0, i + 2)) continue;
      g.player.row = g.player.toRow = g.player.fromRow = i;
      g.player.x = g.player.toX = g.player.fromX = 0;
      g.cam.row = i + 0.6; g.tide.row = i - 7;
      g.runStats.kibble = 10;
      W.row(i + 1).coin = { x: 0, taken: false, bob: 0 };
      W.row(i + 2).coin = { x: 0, taken: false, bob: 0 };
      return g.runCoins;
    }
    return null;
  });
  assert.notEqual(before, null, 'needs three grass rows in a row');
  await a.eval(() => PP.Game.move('up'));
  await a.step(12);
  const after = await a.eval(() => ({ coins: PP.Game.g.runCoins, done: PP.Game.save.directives[0].done }));
  assert.equal(after.done, true);
  assert.equal(after.coins - before, 5 + 40, 'coin plus bounty');
  await a.eval(() => PP.Game.move('up'));
  await a.step(12);
  assert.equal(await a.eval(() => PP.Game.g.runCoins) - after.coins, 5, 'the bounty is paid once');
  await a.close();
});

test('the People\'s Lottery costs 100, always hands out someone new, and never the secret', async () => {
  const a = await openGame({ seed: 33, save: withSave({ coins: 5000 }) });
  const res = await a.eval(() => {
    const out = [];
    let w;
    while ((w = PP.Game.lottery())) out.push({ id: w.id, secret: !!w.secret, coins: PP.Game.save.coins });
    return { wins: out, owned: PP.Game.save.owned.slice(), roster: PP.Characters.ROSTER.map(c => ({ id: c.id, secret: !!c.secret })) };
  });
  const ids = res.wins.map(w => w.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicates');
  assert.ok(res.wins.every(w => !w.secret), 'the secret comrade is not a prize');
  res.wins.forEach((w, i) => assert.equal(w.coins, 5000 - 100 * (i + 1)));
  const lockedPublic = res.roster.filter(c => !c.secret && !['mittens', 'biscuit'].includes(c.id)).length;
  assert.equal(ids.length, lockedPublic, 'every public comrade can be won');
  await a.close();
});

test('the lottery refuses when you cannot pay', async () => {
  const a = await openGame({ seed: 34, save: withSave({ coins: 99 }) });
  assert.equal(await a.eval(() => PP.Game.lottery()), null);
  assert.equal(await a.eval(() => PP.Game.save.coins), 99);
  assert.equal(await a.eval(() => document.getElementById('btn-lottery').disabled), true);
  await a.close();
});

test('three dodges unlock the secret comrade at the end of the run', async () => {
  const a = await openGame({ seed: 35, save: withSave({ dodges: 3 }) });
  await a.page.click('#btn-play');
  await a.step(2);
  await dieAs(a, 'squash');
  const s = await a.eval(() => ({
    owned: PP.Game.save.owned.includes('kotleta'),
    shown: !document.getElementById('o-secret').classList.contains('hidden')
  }));
  assert.deepEqual(s, { owned: true, shown: true });
  await a.close();
});

test('the secret comrade stays redacted in the roster until earned', async () => {
  const a = await openGame({ seed: 36 });
  await a.page.click('#btn-pick');
  const names = await a.eval(() => Array.from(document.querySelectorAll('#roster .name')).map(n => n.textContent));
  assert.ok(names.includes('?????'));
  assert.ok(!names.includes('Kotleta'));
  await a.close();
});

for (const [kind, title] of [['squash', 'FLATTENED'], ['water', 'NATIONALISED'], ['caught', 'REDISTRIBUTED'], ['van', 'DETAINED']]) {
  test(`a ${kind} death gets the ${title} card`, async () => {
    const a = await openGame({ seed: 37 });
    await a.page.click('#btn-play');
    await a.step(2);
    await dieAs(a, kind);
    assert.equal(await a.eval(() => document.getElementById('over-title').textContent), title);
    assert.equal(await a.eval(() => document.getElementById('screen-over').classList.contains('hidden')), false);
    await a.close();
  });
}

test('the run is banked: best, distance bonus and run count persist', async () => {
  const a = await openGame({ seed: 38 });
  await a.page.click('#btn-play');
  await a.step(2);
  await a.eval(() => { PP.Game.g.score = 42; PP.Game.g.maxRow = 44; });
  await dieAs(a, 'water');
  const saved = await a.eval(() => JSON.parse(localStorage.getItem('pp.save')));
  assert.equal(saved.best, 42);
  assert.equal(saved.coins, Math.floor(42 / 5));
  assert.equal(saved.runs, 1);
  assert.equal(await a.eval(() => document.getElementById('o-newbest').classList.contains('hidden')), false);
  assert.equal(await a.eval(() => document.getElementById('o-coins-label').textContent), 'kibble (+8 distance)');
  await a.close();
});

test('kibble and bounties are banked the moment they are earned, even if you quit', async () => {
  const a = await openGame({ seed: 41, save: withSave({ coins: 10, directives: [
    { id: 'coins15', done: false }, { id: 'ice3', done: false }, { id: 'parade2', done: false }
  ] }) });
  await a.page.click('#btn-play');
  await a.step(2);
  await a.eval(() => {
    const g = PP.Game.g;
    g.runStats.kibble = 10;
    PP.World.rows[3] = { index: 3, type: 'grass', decor: [], blocked: {}, coin: { x: 0, taken: false, bob: 0 } };
  });
  await a.eval(() => PP.Game.move('up'));
  await a.step(12);
  // 5 for the pickup, 40 for the directive — already in the bank.
  assert.equal(await a.eval(() => PP.Game.save.coins), 10 + 5 + 40);
  await a.page.keyboard.press('p');
  await a.page.click('#btn-quit');
  assert.equal(await a.eval(() => PP.Game.mode()), 'paused', 'one tap on quit only arms it');
  await a.page.click('#btn-quit');
  const s = await a.eval(() => ({ mode: PP.Game.mode(), coins: PP.Game.save.coins, best: PP.Game.save.best, title: document.getElementById('t-coins').textContent }));
  assert.deepEqual(s, { mode: 'menu', coins: 55, best: 1, title: '55' });
  await a.close();
});

test('restarting mid-run with R banks the run too', async () => {
  const a = await openGame({ seed: 42 });
  await a.page.click('#btn-play');
  await a.step(2);
  await a.eval(() => { PP.Game.g.score = 30; PP.Game.g.maxRow = 32; });
  await a.page.keyboard.press('r');
  await a.step(2);
  const s = await a.eval(() => ({ best: PP.Game.save.best, coins: PP.Game.save.coins, runs: PP.Game.save.runs, score: PP.Game.g.score }));
  assert.deepEqual(s, { best: 30, coins: 6, runs: 2, score: 0 });
  await a.close();
});

test('holding R does not restart on every auto-repeat', async () => {
  const a = await openGame({ seed: 43 });
  await a.page.click('#btn-play');
  await a.step(2);
  await a.eval(() => {
    for (let i = 0; i < 20; i++) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', repeat: i > 0 }));
  });
  assert.equal(await a.eval(() => PP.Game.save.runs), 2);
  await a.close();
});

test('"Hop 500 times" counts hops made after it was issued', async () => {
  const a = await openGame({ seed: 44, save: withSave({ hops: 620, directives: [
    { id: 'hops500', done: false }, { id: 'dist80', done: false }, { id: 'ice3', done: false }
  ] }) });
  assert.match(await a.eval(() => document.getElementById('directives').textContent), /0\/500/);
  await a.page.click('#btn-play');
  await a.step(2);
  await a.eval(() => PP.Game.move('up'));
  await a.step(12);
  assert.equal(await a.eval(() => PP.Game.save.directives[0].done), false);
  await a.close();
});

test('"Break your record" is not handed to someone with no record', async () => {
  const a = await openGame({ seed: 45, save: withSave({ best: 0, directives: [
    { id: 'record', done: false }, { id: 'dist80', done: false }, { id: 'ice3', done: false }
  ] }) });
  const ids = await a.eval(() => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      PP.Game.save.directives.forEach(d => { d.done = true; });
      PP.Game.start();
      PP.Game.save.directives.forEach(d => seen.add(d.id));
    }
    return Array.from(seen);
  });
  assert.ok(!ids.includes('record'), 'record offered to a player with best 0');
  await a.close();
});

test('an old save is migrated: distance counts from the start line', async () => {
  const a = await openGame({ seed: 46, save: { best: 57, coins: 3, runs: 9, owned: ['mittens', 'biscuit'], char: 'mittens' } });
  assert.deepEqual(await a.eval(() => ({ best: PP.Game.save.best, v: PP.Game.save.v })), { best: 55, v: 2 });
  await a.close();
});

test('the black car\'s third miss unlocks the secret comrade on the spot', async () => {
  const a = await openGame({ seed: 47, save: withSave({ dodges: 2 }) });
  await a.page.click('#btn-play');
  await a.step(2);
  await a.eval(() => {
    const g = PP.Game.g;
    g.started = true;
    g.player.dead = false;
    g.van.state = 'arrive'; g.van.t = 0.44; g.van.x = g.player.x + 3; g.van.row = g.player.row;
  });
  await a.step(3);
  assert.equal(await a.eval(() => PP.Game.save.owned.includes('kotleta')), true);
  await a.close();
});

test('an ice death gets its own card', async () => {
  const a = await openGame({ seed: 48 });
  await a.page.click('#btn-play');
  await a.step(2);
  await a.eval(() => {
    const g = PP.Game.g;
    PP.World.rows[3] = { index: 3, type: 'ice', floes: {} };
    g.started = true;
  });
  await a.eval(() => PP.Game.move('up'));
  assert.ok(await a.stepUntil('(PP) => PP.Game.mode() === "dead"', 60 * 5), 'the card should come up');
  assert.equal(await a.eval(() => PP.Game.g.player.deathCause), 'ice');
  assert.equal(await a.eval(() => document.getElementById('over-title').textContent), 'ON THIN ICE');
  await a.close();
});

test('changing comrade from the game-over card comes back to it', async () => {
  const a = await openGame({ seed: 49 });
  await a.page.click('#btn-play');
  await a.step(2);
  await dieAs(a, 'squash');
  await a.page.click('#btn-over-pick');
  await a.page.click('#btn-pick-back');
  assert.equal(await a.eval(() => document.getElementById('screen-over').classList.contains('hidden')), false);
  await a.page.click('#btn-again');
  assert.equal(await a.eval(() => PP.Game.mode()), 'playing');
  await a.close();
});

test('a corrupt or old save does not stop the game from booting', async () => {
  for (const bad of [{ best: 3 }, { owned: [] }, { directives: [{ id: 'gone', done: false }] }]) {
    const a = await openGame({ seed: 39, save: bad });
    await a.page.click('#btn-play');
    await a.step(30);
    assert.equal(await a.eval(() => PP.Game.mode()), 'playing', JSON.stringify(bad));
    assert.deepEqual(a.errors, [], JSON.stringify(bad));
    await a.close();
  }
});

test('pause and resume from the keyboard', async () => {
  const a = await openGame({ seed: 40 });
  await a.page.click('#btn-play');
  await a.step(2);
  await a.page.keyboard.press('p');
  await a.step(2);
  assert.equal(await a.eval(() => PP.Game.mode()), 'paused');
  assert.equal(await a.eval(() => document.getElementById('screen-pause').classList.contains('hidden')), false);
  const tide = await a.eval(() => PP.Game.g.tide.row);
  await a.step(60);
  assert.equal(await a.eval(() => PP.Game.g.tide.row), tide, 'nothing moves while paused');
  await a.page.keyboard.press('p');
  await a.step(2);
  assert.equal(await a.eval(() => PP.Game.mode()), 'playing');
  await a.close();
});

/* The world as a list of row types plus the gates, for comparing maps. */
async function mapOf(a) {
  return a.eval(() => {
    const out = [];
    for (let i = 0; i < 300; i++) {
      const r = PP.World.row(i);
      out.push(r.type + (r.gateX !== undefined ? r.gateX : '') + (r.type === 'grass' ? Object.keys(r.blocked).join(',') : ''));
    }
    return out.join('|');
  });
}

test('the Daily Escape is the same map for everyone, and a normal run is not', async () => {
  const one = await openGame({ seed: 81 });
  const two = await openGame({ seed: 82 });
  for (const a of [one, two]) { await a.page.click('#btn-daily'); await a.step(2); }
  assert.equal(await mapOf(one), await mapOf(two));
  for (const a of [one, two]) { await a.eval(() => PP.Game.start({ daily: false })); }
  assert.notEqual(await mapOf(one), await mapOf(two));
  await one.close();
  await two.close();
});

test('a Daily Escape run is labelled, remembered and repeatable', async () => {
  const a = await openGame({ seed: 83 });
  await a.page.click('#btn-daily');
  await a.step(2);
  const seed = await a.eval(() => PP.World.seed());
  await a.eval(() => { PP.Game.g.score = 12; PP.Game.g.maxRow = 14; });
  await dieAs(a, 'squash');
  assert.equal(await a.eval(() => document.getElementById('o-daily').classList.contains('hidden')), false);
  assert.match(await a.eval(() => document.getElementById('o-daily').textContent), /DAILY ESCAPE/);
  assert.equal(await a.eval(() => PP.Game.dailyBest()), 12);
  await a.page.click('#btn-again');
  assert.equal(await a.eval(() => PP.World.seed()), seed, 'RUN AGAIN stays on the daily map');
  await a.page.keyboard.press('p');
  await a.page.click('#btn-quit');
  await a.page.click('#btn-quit');
  assert.match(await a.eval(() => document.getElementById('daily-sub').textContent), /12 m/);
  await a.close();
});

test('Share sends your distance and a link to the game', async () => {
  const a = await openGame({ seed: 84 });
  await a.eval(() => { navigator.share = (d) => { window.__shared = d; return Promise.resolve(); }; });
  await a.page.click('#btn-daily');
  await a.step(2);
  await a.eval(() => { PP.Game.g.score = 23; PP.Game.g.maxRow = 25; });
  await dieAs(a, 'water');
  await a.page.click('#btn-share');
  const shared = await a.eval(() => window.__shared);
  assert.match(shared.text, /23 m/);
  assert.match(shared.text, /Daily Escape/);
  assert.match(shared.url, /\?daily$/);
  await a.close();
});

test('a Daily Escape link points the visitor at today\'s map', async () => {
  const path = require('path');
  const a = await openGame({ seed: 85, url: 'file://' + path.resolve(__dirname, '..', 'index.html') + '?daily' });
  assert.equal(await a.eval(() => document.getElementById('btn-daily').classList.contains('invited')), true);
  await a.close();
});

test('hiding the tab saves the record and the distance bonus so far, once', async () => {
  const a = await openGame({ seed: 86 });
  await a.page.click('#btn-play');
  await a.step(2);
  await a.eval(() => { PP.Game.g.score = 12; PP.Game.g.maxRow = 14; PP.Game.g.started = true; });
  await a.eval(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const saved = await a.eval(() => JSON.parse(localStorage.getItem('pp.save')));
  assert.deepEqual({ best: saved.best, coins: saved.coins }, { best: 12, coins: 2 });
  assert.equal(await a.eval(() => PP.Game.mode()), 'paused');
  // Finishing the run later pays only what is still owed.
  await a.eval(() => { delete document.hidden; PP.Game.resume(); PP.Game.g.score = 15; });
  await dieAs(a, 'squash');
  assert.equal(await a.eval(() => PP.Game.save.coins), 3);
  await a.close();
});
