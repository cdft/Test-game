/* Core mechanics: every way to move, score, earn and die, driven frame by
 * frame on a seeded world so results never depend on machine speed. */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openGame, closeBrowser } = require('./helpers');

test.after(closeBrowser);

/* Start a run through the real UI, then put the player somewhere specific.
 * `find` is a function source run in the page: (W, from) => row index. */
async function runAt(a, place) {
  await a.page.click('#btn-play');
  await a.step(2);
  return a.eval((src) => {
    const g = PP.Game.g, W = PP.World;
    const spot = new Function('W', 'g', 'return (' + src + ')(W, g)')(W, g);
    if (!spot) return null;
    g.player.row = spot.row; g.player.x = spot.x;
    g.player.fromRow = spot.row; g.player.toRow = spot.row;
    g.player.fromX = spot.x; g.player.toX = spot.x;
    g.player.hopping = false;
    g.cam.row = spot.row + 0.6; g.cam.x = Math.max(-3.2, Math.min(3.2, spot.x));
    g.tide.row = spot.row - (spot.lead || 9);
    g.idleT = 0;
    g.maxRow = Math.max(g.maxRow, spot.row);
    g.started = true;   // as if the first hop had been made
    return spot;
  }, place.toString());
}

async function state(a) {
  return a.eval(() => {
    const g = PP.Game.g;
    return {
      mode: PP.Game.mode(), row: g.player.row, x: g.player.x, dead: g.player.dead,
      kind: g.player.deathKind, score: g.score, coins: g.runCoins, tide: g.tide.row,
      streak: g.streak, van: g.van.state, slowmo: g.slowmoT, splashes: g.splashes.length
    };
  });
}

test('the first hop is the first metre', async () => {
  const a = await openGame({ seed: 11 });
  await a.page.click('#btn-play');
  await a.step(2);
  assert.equal((await state(a)).score, 0);
  await a.eval(() => PP.Game.move('up'));
  await a.step(12);
  const s = await state(a);
  assert.equal(s.row, 3);
  assert.equal(s.score, 1);
  assert.equal(s.dead, false);
  assert.deepEqual(a.errors, []);
  await a.close();
});

test('standing in a car\'s path flattens you, with a beat of slow motion', async () => {
  const a = await openGame({ seed: 12 });
  await runAt(a, (W) => {
    for (let i = 5; i < 200; i++) {
      const r = W.row(i);
      if (r.type === 'road') return { row: i, x: Math.round(W.carX(r, r.cars[0])) };
    }
  });
  await a.step(2);
  const s = await state(a);
  assert.equal(s.kind, 'squash');
  assert.ok(s.slowmo > 0, 'slow motion should engage');
  assert.deepEqual(a.errors, []);
  await a.close();
});

test('open water drowns you and throws up a splash', async () => {
  const a = await openGame({ seed: 13 });
  await runAt(a, (W) => {
    for (let i = 5; i < 200; i++) {
      if (W.row(i).type !== 'water') continue;
      for (let x = W.CFG.X_MIN; x <= W.CFG.X_MAX; x++) if (!W.logUnder(x, i)) return { row: i, x: x };
    }
  });
  await a.step(2);
  const s = await state(a);
  assert.equal(s.kind, 'water');
  assert.ok(s.splashes >= 1, 'a splash should be spawned');
  await a.close();
});

test('a log carries you with the current', async () => {
  const a = await openGame({ seed: 14 });
  const spot = await runAt(a, (W) => {
    for (let i = 5; i < 200; i++) {
      const r = W.row(i);
      if (r.type !== 'water') continue;
      for (const lg of r.logs) {
        const lx = W.logX(r, lg);
        if (Math.abs(lx) < 3 && lg.w >= 3) return { row: i, x: lx, dir: r.dir, speed: r.speed };
      }
    }
  });
  await a.step(30);
  const s = await state(a);
  assert.equal(s.dead, false);
  const moved = s.x - spot.x;
  assert.ok(Math.sign(moved) === spot.dir && Math.abs(moved) > 0.2, `drifted ${moved.toFixed(2)} tiles`);
  await a.close();
});

test('an ice floe cracks, then sinks under you', async () => {
  const a = await openGame({ seed: 15 });
  await runAt(a, (W) => {
    for (let i = 26; i < 500; i++) {
      const r = W.row(i);
      if (r.type !== 'ice') continue;
      for (let x = -3; x <= 3; x++) if (r.floes[x]) return { row: i, x: x };
    }
  });
  const seen = [];
  for (let f = 0; f < 150; f += 5) {
    await a.eval(() => { PP.Game.g.idleT = 0; });
    await a.step(5);
    const st = await a.eval(() => {
      const p = PP.Game.g.player, fl = PP.World.floeAt(p.x, p.row);
      return fl ? fl.state : 'none';
    });
    if (seen[seen.length - 1] !== st) seen.push(st);
    if ((await state(a)).dead) break;
  }
  const s = await state(a);
  assert.deepEqual(seen.slice(0, 3), ['solid', 'cracking', 'sunk']);
  assert.equal(s.kind, 'water');
  await a.close();
});

test('walking into a parade conscripts you instead of flattening you', async () => {
  const a = await openGame({ seed: 16 });
  await runAt(a, (W) => {
    for (let i = 13; i < 500; i++) {
      const r = W.row(i);
      if (r.type === 'parade') return { row: i, x: W.carX(r, r.cars[0]) };
    }
  });
  await a.step(2);
  assert.equal((await state(a)).kind, 'caught');
  await a.step(60 * 3.2);
  const card = await a.eval(() => document.getElementById('over-title').textContent);
  assert.equal(card, 'CONSCRIPTED');
  await a.close();
});

test('the tide converts a player who stands still', async () => {
  const a = await openGame({ seed: 17 });
  await runAt(a, () => ({ row: 3, x: 0, lead: 0.5 }));
  assert.ok(await a.stepUntil('(PP) => PP.Game.g.player.dead', 240), 'the tide should arrive');
  assert.equal((await state(a)).kind, 'caught');
  await a.step(60);
  const conv = await a.eval(() => ({ t: PP.Game.g.player.convertT, char: !!PP.Game.g.playerChar }));
  assert.ok(conv.t > 0.5, 'conversion should be under way (' + conv.t + ')');
  assert.equal(conv.char, true, 'the recoloured comrade should be drawn');
  await a.close();
});

test('the black car collects an idler with a comfortable lead', async () => {
  const a = await openGame({ seed: 18 });
  await runAt(a, (W) => {
    for (let i = 6; i < 200; i++) if (W.row(i).type === 'grass') return { row: i, x: 0, lead: 12 };
  });
  const states = [];
  for (let f = 0; f < 60 * 7; f += 5) {
    await a.eval(() => { const g = PP.Game.g; g.tide.row = Math.min(g.tide.row, g.player.row - 8); });
    await a.step(5);
    const s = await state(a);
    if (states[states.length - 1] !== s.van) states.push(s.van);
    if (s.dead) break;
  }
  assert.deepEqual(states.slice(0, 4), ['idle', 'warn', 'arrive', 'grab']);
  assert.equal((await state(a)).kind, 'van');
  await a.close();
});

test('stepping out of the ring makes the black car miss, and counts as a dodge', async () => {
  const a = await openGame({ seed: 19 });
  await runAt(a, (W) => {
    for (let i = 6; i < 200; i++) if (W.row(i).type === 'grass' && W.row(i).blocked[1] !== true) return { row: i, x: 0, lead: 12 };
  });
  await a.eval(() => { PP.Game.g.idleT = 4.3; });
  await a.step(10);
  assert.equal((await state(a)).van, 'warn');
  const before = await a.eval(() => PP.Game.save.dodges || 0);
  await a.eval(() => PP.Game.move('right'));
  await a.step(60 * 1.5);
  const s = await state(a);
  assert.equal(s.dead, false);
  assert.equal(await a.eval(() => PP.Game.save.dodges), before + 1);
  await a.close();
});

test('a sector wall blocks you; its gate pays out and pushes the tide back', async () => {
  const a = await openGame({ seed: 20 });
  const spot = await runAt(a, (W) => {
    const r = W.CFG.START_ROW + 50;
    const gate = W.row(r).gateX;
    return { row: r - 1, x: gate >= 0 ? gate - 3 : gate + 3, lead: 6, wall: r, gate: gate };
  });
  const wall = { row: spot.wall };
  const gate = spot.gate;
  assert.equal(await a.eval((r) => PP.World.row(r).type, wall.row), 'checkpoint', 'the wall sits at 50m');
  // Clear the approach row so only the wall can stop us.
  await a.eval((r) => { PP.World.rows[r] = { index: r, type: 'grass', decor: [], blocked: {}, coin: null }; }, wall.row - 1);
  await a.eval(() => PP.Game.move('up'));
  await a.step(12);
  assert.equal((await state(a)).row, wall.row - 1, 'the wall must stop the hop');

  await a.eval(([gx, r]) => {
    const g = PP.Game.g;
    g.player.row = g.player.toRow = g.player.fromRow = r;
    g.player.x = g.player.fromX = g.player.toX = gx;
    g.maxRow = r; g.score = r - PP.World.CFG.START_ROW;
  }, [gate, wall.row]);
  // And make sure the row past the gate is open ground.
  await a.eval((r) => { PP.World.rows[r] = { index: r, type: 'grass', decor: [], blocked: {}, coin: null }; }, wall.row + 1);
  const before = await state(a);
  await a.eval(() => PP.Game.move('up'));
  await a.step(12);
  const after = await state(a);
  assert.equal(after.row, wall.row + 1, 'through the gate');
  assert.ok(after.coins - before.coins >= 25, 'bounty of 25 kibble');
  assert.ok(before.tide - after.tide > 1, 'the tide should lose ground');
  await a.close();
});

test('momentum: a 10-hop streak doubles kibble', async () => {
  const a = await openGame({ seed: 21 });
  const spot = await runAt(a, (W) => {
    for (let i = 5; i < 300; i++) if (W.row(i).type === 'grass' && W.row(i + 1).type === 'grass' && !W.row(i + 1).blocked[0]) return { row: i, x: 0 };
  });
  await a.eval((r) => {
    const g = PP.Game.g;
    g.streak = 12; g.lastFwdT = PP.World.time();
    PP.World.row(r + 1).coin = { x: 0, taken: false, bob: 0 };
  }, spot.row);
  const before = (await state(a)).coins;
  await a.eval(() => PP.Game.move('up'));
  await a.step(12);
  assert.equal((await state(a)).coins - before, 10);
  await a.close();
});

test('your record is drawn in the world and crossing it is noticed', async () => {
  const a = await openGame({ seed: 22, save: { best: 3, coins: 0, runs: 1, owned: ['mittens', 'biscuit'], char: 'mittens', v: 2 } });
  await runAt(a, () => ({ row: 2, x: 0 }));
  // A best of 3m is drawn on row 5 (the start line is row 2).
  assert.equal(await a.eval(() => PP.Game.g.bestLineRow), 5);
  await a.eval(() => {
    for (let i = 3; i <= 6; i++) {
      PP.World.rows[i] = { index: i, type: 'grass', decor: [], blocked: {}, coin: null };
    }
  });
  for (let i = 0; i < 4; i++) { await a.eval(() => PP.Game.move('up')); await a.step(12); }
  const s = await a.eval(() => ({ crossed: PP.Game.g.bestCrossed, score: PP.Game.g.score, dead: PP.Game.g.player.dead }));
  assert.deepEqual(s, { crossed: true, score: 4, dead: false });
  await a.close();
});

test('press crouches, release hops', async () => {
  const a = await openGame({ seed: 23 });
  await runAt(a, () => ({ row: 2, x: 0 }));
  await a.eval(() => PP.Game.charge());
  assert.equal(await a.eval(() => PP.Game.g.player.charging), true);
  await a.eval(() => PP.Game.move('up'));
  assert.equal(await a.eval(() => PP.Game.g.player.charging), false);
  await a.close();
});

test('the chase waits for your first hop', async () => {
  const a = await openGame({ seed: 24 });
  await a.page.click('#btn-play');
  const tide0 = await a.eval(() => PP.Game.g.tide.row);
  await a.step(60 * 8);
  const s = await state(a);
  assert.equal(s.dead, false);
  assert.equal(s.tide, tide0, 'the tide must not move before the first hop');
  await a.eval(() => PP.Game.move('up'));
  await a.step(30);
  assert.ok((await state(a)).tide > tide0, 'and it moves once you do');
  await a.close();
});

test('mashing a direction cannot walk you across open water', async () => {
  const a = await openGame({ seed: 25 });
  await runAt(a, () => ({ row: 2, x: 0 }));
  await a.eval(() => {
    for (let i = 3; i <= 5; i++) PP.World.rows[i] = { index: i, type: 'water', dir: 1, speed: 1, logs: [] };
  });
  // Press on every frame, the way a held key or frantic thumb does.
  for (let f = 0; f < 60; f++) {
    await a.eval(() => PP.Game.move('up'));
    await a.step(1);
  }
  const s = await state(a);
  assert.equal(s.kind, 'water');
  assert.equal(s.row, 3, 'drowned in the first canal');
  await a.close();
});

test('mashing a direction cannot walk you across missing ice', async () => {
  const a = await openGame({ seed: 26 });
  await runAt(a, () => ({ row: 2, x: 0 }));
  await a.eval(() => {
    PP.World.rows[3] = { index: 3, type: 'ice', floes: {} };
    PP.World.rows[4] = { index: 4, type: 'grass', decor: [], blocked: {}, coin: null };
  });
  for (let f = 0; f < 40; f++) {
    await a.eval(() => PP.Game.move('up'));
    await a.step(1);
  }
  assert.equal((await state(a)).row, 3);
  assert.equal((await state(a)).dead, true);
  await a.close();
});

test('momentum fades the moment you stop', async () => {
  const a = await openGame({ seed: 27 });
  await runAt(a, () => ({ row: 2, x: 0 }));
  await a.eval(() => {
    const g = PP.Game.g;
    g.streak = 12; g.lastFwdT = PP.World.time();
  });
  await a.step(2);
  assert.equal((await state(a)).streak, 12);
  await a.step(60);
  assert.equal((await state(a)).streak, 0, 'a second of standing still ends it');
  await a.close();
});

test('bouncing back and forth builds no momentum', async () => {
  const a = await openGame({ seed: 28 });
  await runAt(a, () => ({ row: 3, x: 0 }));
  await a.eval(() => {
    for (let i = 2; i <= 4; i++) PP.World.rows[i] = { index: i, type: 'grass', decor: [], blocked: {}, coin: null };
    PP.Game.g.maxRow = 4;
  });
  for (let i = 0; i < 12; i++) {
    await a.eval(() => PP.Game.move('up')); await a.step(10);
    await a.eval(() => PP.Game.move('down')); await a.step(10);
  }
  assert.ok((await state(a)).streak < 2);
  await a.close();
});

test('riding a log to the very edge still lets you hop off it', async () => {
  const a = await openGame({ seed: 29 });
  await runAt(a, () => ({ row: 3, x: 0 }));
  await a.eval(() => {
    const g = PP.Game.g;
    PP.World.rows[3] = { index: 3, type: 'water', dir: 1, speed: 0, logs: [{ p: 7.6 - PP.World.CFG.TRACK_MIN, w: 3, kind: 'log', seed: 0 }] };
    PP.World.rows[4] = { index: 4, type: 'grass', decor: [], blocked: {}, coin: null };
    g.player.x = g.player.fromX = g.player.toX = 7.6;
  });
  await a.eval(() => PP.Game.move('up'));
  await a.step(12);
  const s = await state(a);
  assert.deepEqual({ row: s.row, x: s.x, dead: s.dead }, { row: 4, x: 7, dead: false });
  await a.close();
});

test('ten quick hops onto new ground really do build momentum', async () => {
  const a = await openGame({ seed: 30 });
  await runAt(a, () => ({ row: 2, x: 0 }));
  await a.eval(() => {
    for (let i = 2; i <= 20; i++) PP.World.rows[i] = { index: i, type: 'grass', decor: [], blocked: {}, coin: null };
  });
  for (let i = 0; i < 12; i++) {
    await a.eval(() => PP.Game.move('up'));
    await a.step(12);   // ~0.2 s a hop: well inside the 0.9 s window
  }
  const s = await a.eval(() => ({ streak: PP.Game.g.streak, combo: !document.getElementById('combo').classList.contains('hidden') }));
  assert.ok(s.streak >= 10, `streak ${s.streak}`);
  assert.equal(s.combo, true, 'the x2 badge shows');
  await a.close();
});

test('hopping inward off a log at the map edge lands one column over, still on the log', async () => {
  const a = await openGame({ seed: 31 });
  await runAt(a, () => ({ row: 3, x: 0 }));
  await a.eval(() => {
    const g = PP.Game.g, W = PP.World;
    // A 2-wide log centred at 7.4, standing still; the player rides its outer end.
    W.rows[3] = { index: 3, type: 'water', dir: 1, speed: 0, logs: [{ p: 7.4 - W.CFG.TRACK_MIN, w: 2, kind: 'log', seed: 0 }] };
    g.player.x = g.player.fromX = g.player.toX = 7.6;
  });
  await a.eval(() => PP.Game.move('left'));
  await a.step(12);
  const s = await state(a);
  assert.deepEqual({ x: s.x, dead: s.dead }, { x: 7, dead: false });
  await a.close();
});

test('the record line is labelled in metres', async () => {
  const a = await openGame({ seed: 32, save: { best: 10, coins: 0, runs: 1, owned: ['mittens', 'biscuit'], char: 'mittens', v: 2 } });
  await runAt(a, () => ({ row: 8, x: 0 }));
  const labels = await a.eval(() => {
    const seen = [];
    const real = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (t) { if (/^BEST/.test(t)) seen.push(t); return real.apply(this, arguments); };
    PP.Render.draw(PP.Game.g);
    CanvasRenderingContext2D.prototype.fillText = real;
    return seen;
  });
  assert.deepEqual(labels, ['BEST 10']);
  await a.close();
});
