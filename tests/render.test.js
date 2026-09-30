/* Drawing: every kind of row, every comrade, every screen size, without a
 * single console error — and a horizon that stays put while you run. */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openGame, closeBrowser } = require('./helpers');

test.after(closeBrowser);

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844, dpr: 3, hasTouch: true, isMobile: true },
  { name: 'small phone landscape', width: 667, height: 375, dpr: 2, hasTouch: true, isMobile: true },
  { name: 'tablet', width: 820, height: 1180, dpr: 2, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, dpr: 1 }
];

/* How many distinct colours a sample grid of the canvas holds. A blank or
 * single-colour frame means drawing silently failed. */
async function colourVariety(a) {
  return a.eval(() => {
    const c = document.getElementById('stage');
    const ctx = c.getContext('2d');
    const seen = new Set();
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 12; x++) {
        const d = ctx.getImageData(Math.floor((x + 0.5) * c.width / 12), Math.floor((y + 0.5) * c.height / 12), 1, 1).data;
        seen.add((d[0] >> 3) + ',' + (d[1] >> 3) + ',' + (d[2] >> 3));
      }
    }
    return seen.size;
  });
}

for (const vp of VIEWPORTS) {
  test(`${vp.name}: every row type draws cleanly`, async () => {
    const a = await openGame({ seed: 51, viewport: { width: vp.width, height: vp.height }, dpr: vp.dpr, hasTouch: vp.hasTouch, isMobile: vp.isMobile });
    await a.page.click('#btn-play');
    await a.step(2);
    // Visit the first row of each type, and a few sector walls, drawing a
    // handful of frames at each.
    const stops = await a.eval(() => {
      const W = PP.World, seen = {}, out = [];
      for (let i = 4; i < 420; i++) {
        const t = W.row(i).type;
        if (!seen[t] || t === 'checkpoint') { seen[t] = true; out.push({ row: i, type: t }); }
      }
      return out;
    });
    const types = new Set(stops.map(s => s.type));
    for (const t of ['grass', 'road', 'water', 'rail', 'ice', 'parade', 'checkpoint']) {
      assert.ok(types.has(t), `no ${t} row generated in 420 rows`);
    }
    for (const s of stops) {
      await a.eval((r) => {
        const g = PP.Game.g;
        g.player.row = g.player.toRow = g.player.fromRow = r;
        g.player.x = g.player.toX = g.player.fromX = 0;
        g.player.dead = false; g.mode = 'playing';
        g.cam.row = r + 0.6; g.tide.row = r - 20; g.idleT = 0;
        // Render only: keep the collision checks from ending the run.
        g.player.hopping = true; g.player.hopT = 0;
      }, s.row);
      await a.step(4);
      assert.ok(await colourVariety(a) >= 6, `row ${s.row} (${s.type}) looks blank`);
    }
    // The canvas backs the CSS box at device resolution (capped at 2x).
    const size = await a.eval(() => {
      const c = document.getElementById('stage');
      return { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight };
    });
    assert.ok(size.w >= size.cw && size.h >= size.ch, 'canvas is not scaled for the screen');
    assert.deepEqual(a.errors, []);
    await a.close();
  });
}

test('every comrade has a portrait', async () => {
  const a = await openGame({ seed: 52, save: { best: 0, coins: 0, runs: 0, owned: ['mittens', 'biscuit'], char: 'mittens', dodges: 3 } });
  const blank = await a.eval(() => {
    const out = [];
    for (const c of PP.Characters.ROSTER) {
      const cnv = document.createElement('canvas');
      PP.Render.drawPortrait(cnv, c);
      const d = cnv.getContext('2d').getImageData(0, 0, cnv.width, cnv.height).data;
      let ink = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) ink++;
      if (ink < 200) out.push(c.id);
    }
    return out;
  });
  assert.deepEqual(blank, []);
  assert.deepEqual(a.errors, []);
  await a.close();
});

test('every comrade can actually be played', async () => {
  const a = await openGame({ seed: 53 });
  const ids = await a.eval(() => PP.Characters.ROSTER.map(c => c.id));
  for (const id of ids) {
    await a.eval((cid) => {
      PP.Game.save.owned = PP.Characters.ROSTER.map(c => c.id);
      PP.Game.setChar(cid);
      PP.Game.start();
      PP.Game.move('up');
    }, id);
    await a.step(20);
  }
  assert.deepEqual(a.errors, []);
  await a.close();
});

test('the horizon stays put as you run', async () => {
  const a = await openGame({ seed: 54 });
  await a.page.click('#btn-play');
  await a.step(2);
  const ys = [];
  for (let r = 0; r < 40; r += 3) {
    await a.eval((row) => {
      const g = PP.Game.g;
      g.player.row = g.player.toRow = g.player.fromRow = row;
      g.player.hopping = true; g.player.hopT = 0;
      g.cam.row = row + 0.6; g.tide.row = row - 20; g.idleT = 0;
    }, r);
    await a.step(2);
    ys.push(await a.eval(() => PP.Render.view.horizonY));
  }
  assert.ok(ys.every(y => typeof y === 'number'), 'Render.view.horizonY should be exposed');
  assert.ok(Math.max(...ys) - Math.min(...ys) < 0.5, `horizon moved: ${ys.join(', ')}`);
  await a.close();
});

test('resizing mid-run keeps drawing', async () => {
  const a = await openGame({ seed: 55 });
  await a.page.click('#btn-play');
  await a.step(10);
  for (const [w, h] of [[844, 390], [390, 844], [1280, 720], [320, 568]]) {
    await a.page.setViewportSize({ width: w, height: h });
    // The browser delivers 'resize' on its own rendering tick, not ours.
    await a.page.waitForFunction(([ww, hh]) => PP.Render.view.w === ww && PP.Render.view.h === hh, [w, h], { polling: 50 });
    await a.step(6);
    assert.ok(await colourVariety(a) >= 6, `blank at ${w}x${h}`);
  }
  assert.deepEqual(a.errors, []);
  await a.close();
});

test('a busy frame draws within budget', async () => {
  const a = await openGame({ seed: 56, viewport: { width: 390, height: 844 }, dpr: 2 });
  await a.page.click('#btn-play');
  await a.step(2);
  const ms = await a.eval(() => {
    const g = PP.Game.g;
    let r = 0;
    for (let i = 150; i < 300; i++) if (PP.World.row(i).type === 'road') { r = i; break; }
    g.player.row = g.player.toRow = g.player.fromRow = r - 1;
    g.cam.row = r; g.tide.row = r - 5;
    g.player.hopping = true; g.player.hopT = 0;
    for (let i = 0; i < 10; i++) PP.Render.draw(g);  // warm up
    const t0 = performance.now();
    for (let i = 0; i < 60; i++) PP.Render.draw(g);
    return (performance.now() - t0) / 60;
  });
  // Generous: headless software rendering is far slower than a phone GPU,
  // so this only catches a real regression (e.g. an accidental O(n²) pass).
  const budget = Number(process.env.FRAME_BUDGET_MS || 80);
  assert.ok(ms < budget, `a frame took ${ms.toFixed(1)}ms (budget ${budget}ms)`);
  await a.close();
});

test('the single-file bundle boots and plays', async () => {
  const path = require('path');
  const url = 'file://' + path.resolve(__dirname, '..', 'dist', 'play.html');
  const a = await openGame({ seed: 57, url, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  assert.equal(await a.eval(() => document.compatMode), 'CSS1Compat');
  assert.equal(await a.eval(() => document.querySelector('title').parentNode.nodeName), 'HEAD');
  await a.page.click('#btn-play');
  await a.eval(() => PP.Game.move('up'));
  await a.step(20);
  assert.equal(await a.eval(() => PP.Game.mode()), 'playing');
  assert.ok(await colourVariety(a) >= 6);
  assert.deepEqual(a.errors, []);
  await a.close();
});

test('a paused game stops repainting the frozen scene', async () => {
  const a = await openGame({ seed: 58 });
  await a.page.click('#btn-play');
  await a.step(5);
  await a.page.click('#btn-pause');
  const draws = await a.eval(() => {
    let n = 0;
    const real = PP.Render.draw;
    PP.Render.draw = function (g) { n++; return real(g); };
    window.__step(60);
    PP.Render.draw = real;
    return n;
  });
  assert.ok(draws <= 1, `${draws} redraws of a paused frame`);
  await a.close();
});

test('the regime\'s animals are drawn once and stamped after that', async () => {
  const a = await openGame({ seed: 59 });
  await a.page.click('#btn-play');
  await a.step(2);
  const made = await a.eval(() => {
    const g = PP.Game.g;
    for (let i = 20; i < 200; i++) if (PP.World.row(i).type === 'parade') { g.cam.row = i; g.player.row = g.player.toRow = g.player.fromRow = i - 1; break; }
    g.player.hopping = true; g.tide.row = g.player.row - 2.5;
    for (let i = 0; i < 10; i++) PP.Render.draw(g);   // warm the cache
    let n = 0;
    const real = document.createElement.bind(document);
    document.createElement = function (tag) { if (String(tag).toLowerCase() === 'canvas') n++; return real(tag); };
    for (let i = 0; i < 30; i++) PP.Render.draw(g);
    document.createElement = real;
    return n;
  });
  assert.equal(made, 0, 'no new sprite canvases once warm');
  await a.close();
});

test('ground markings (the record line) never paint over the skyline', async () => {
  const a = await openGame({ seed: 60 });
  await a.page.click('#btn-play');
  await a.step(2);
  const changed = await a.eval(() => {
    const g = PP.Game.g, v = PP.Render.view;
    g.player.hopping = true; g.tide.row = -20;
    PP.Render.draw(g);
    // Put the camera so the far row straddles the horizon line.
    const depth = Math.max(6, Math.min(16, (v.baseY - v.h * 0.17) / v.rowH));
    const far = 40;
    g.cam.row = far - depth + 0.4;
    const c = document.getElementById('stage'), ctx = c.getContext('2d');
    const sky = () => {
      PP.Render.draw(g);
      const hy = Math.floor(PP.Render.view.horizonY * v.dpr) - 1;
      return Array.from(ctx.getImageData(0, 0, c.width, hy).data);
    };
    g.bestLineRow = -1;
    const without = sky();
    g.bestLineRow = far;
    const withLine = sky();
    let n = 0;
    for (let i = 0; i < without.length; i++) if (Math.abs(without[i] - withLine[i]) > 2) n++;
    return n;
  });
  assert.equal(changed, 0, `${changed} sky pixel channels changed by the record line`);
  await a.close();
});

test('the far backdrop holds still when you hop forward', async () => {
  const a = await openGame({ seed: 61 });
  await a.page.click('#btn-play');
  await a.step(2);
  const worst = await a.eval(() => {
    const g = PP.Game.g, c = document.getElementById('stage'), ctx = c.getContext('2d');
    const sky = () => {
      PP.Render.draw(g);
      const hy = Math.floor(PP.Render.view.horizonY * PP.Render.view.dpr) - 2;
      return ctx.getImageData(0, 0, c.width, hy).data;
    };
    g.player.hopping = true; g.tide.row = -20;
    // Bare ground, so only the backdrop itself is measured.
    for (let i = 0; i < 90; i++) PP.World.rows[i] = { index: i, type: 'grass', decor: [], blocked: {}, coin: null };
    let worst = 0;
    // (Snow starts at 26 m and is close to you, so it rightly moves; stay short of it.)
    for (let r = 2; r < 24; r += 3) {
      g.cam.row = r + 0.6;
      const before = sky();
      g.cam.row = r + 1.6;   // one hop forward, same instant
      const after = sky();
      let sum = 0;
      for (let i = 0; i < before.length; i++) sum += Math.abs(before[i] - after[i]);
      worst = Math.max(worst, sum / before.length);
    }
    return worst;
  });
  // The journey shifts colours (and sets the sun) over tens of metres, so one
  // hop changes the backdrop imperceptibly; a jump would change it a lot.
  assert.ok(worst < 1.5, `the backdrop changed by ${worst.toFixed(2)}/255 on average in one hop`);
  await a.close();
});

test('scenery on the far rows stays faint against the skyline', async () => {
  const a = await openGame({ seed: 64 });
  await a.page.click('#btn-play');
  await a.step(2);
  const worst = await a.eval(() => {
    const g = PP.Game.g, c = document.getElementById('stage'), ctx = c.getContext('2d');
    g.player.hopping = true; g.tide.row = -20;
    const v = PP.Render.view;
    const sky = () => {
      PP.Render.draw(g);
      const hy = Math.floor(v.horizonY * v.dpr) - 2;
      return ctx.getImageData(0, 0, c.width, hy).data;
    };
    let worst = 0;
    for (let r = 10; r < 40; r += 3) {
      g.cam.row = r + 0.6;
      // Bare, then a row of tall trees on every row near the horizon.
      for (let i = r; i < r + 20; i++) PP.World.rows[i] = { index: i, type: 'grass', decor: [], blocked: {}, coin: null };
      const bare = sky();
      for (let i = r; i < r + 20; i++) {
        const decor = [];
        for (let x = -7; x <= 7; x += 2) decor.push({ x: x, kind: 'tree', h: 1.7, seed: 0.5 });
        PP.World.rows[i].decor = decor;
      }
      const trees = sky();
      let sum = 0;
      for (let i = 0; i < bare.length; i += 4) sum += Math.abs(bare[i] - trees[i]) + Math.abs(bare[i + 1] - trees[i + 1]) + Math.abs(bare[i + 2] - trees[i + 2]);
      worst = Math.max(worst, sum / (bare.length / 4));
    }
    return worst;
  });
  assert.ok(worst < 6, `trees change the sky by ${worst.toFixed(1)} per pixel on average`);
  await a.close();
});
