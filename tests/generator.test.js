/* World-generator invariants: the promises the level generator makes about
 * every world it builds, checked over hundreds of rows and several seeds.
 * These are the rules that keep the game fair — a regression here means some
 * players get a world they cannot survive. */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openGame, closeBrowser } = require('./helpers');

const SEEDS = [1, 2, 3, 42, 1337];
const MANY_SEEDS = Array.from({ length: 60 }, (_, i) => 1000 + i);
const ROWS = 600;

test.after(closeBrowser);

/* Generates ROWS rows in the page and returns a compact description of each. */
async function survey(seed) {
  const a = await openGame({ seed });
  const rows = await a.eval((n) => {
    const W = PP.World;
    PP.Game.start();
    W.row(n); // generate everything in order, before anything else draws randoms
    const out = [];
    for (let i = 0; i < n; i++) {
      const r = W.row(i);
      const o = { i: i, type: r.type };
      if (r.type === 'grass') {
        let free = 0;
        for (let x = W.CFG.X_MIN; x <= W.CFG.X_MAX; x++) if (!r.blocked[x]) free++;
        o.free = free;
        o.decor = r.decor.length;
        o.blocked = Object.keys(r.blocked).filter(k => r.blocked[k]).map(Number);
      }
      if (r.type === 'road' || r.type === 'parade') o.items = r.cars.map(c => ({ p: c.p, w: c.w }));
      if (r.type === 'water') o.items = r.logs.map(l => ({ p: l.p, w: l.w }));
      if (r.type === 'ice') {
        o.floes = [];
        for (let x = W.CFG.X_MIN; x <= W.CFG.X_MAX; x++) o.floes.push(!!r.floes[x]);
      }
      if (r.type === 'checkpoint') {
        o.gateX = r.gateX;
        o.open = [];
        for (let x = W.CFG.X_MIN; x <= W.CFG.X_MAX; x++) if (!W.isBlocked(x, i)) o.open.push(x);
      }
      out.push(o);
    }
    return { rows: out, trackLen: W.CFG.TRACK_LEN, xMin: W.CFG.X_MIN, xMax: W.CFG.X_MAX, startRow: W.CFG.START_ROW };
  }, ROWS);
  await a.close();
  assert.deepEqual(a.errors, []);
  return rows;
}

/* Gaps between consecutive items around the looped track, seam included. */
function loopGaps(items, trackLen) {
  const sorted = items.map(it => ({ p: ((it.p % trackLen) + trackLen) % trackLen, w: it.w }))
    .sort((x, y) => x.p - y.p);
  return sorted.map((it, k) => {
    const next = k + 1 < sorted.length ? sorted[k + 1] : { p: sorted[0].p + trackLen, w: sorted[0].w };
    // p is the item's reference point; widths extend half each way.
    return (next.p - it.p) - (it.w + next.w) / 2;
  });
}

/* Columns you can stand on, for rows whose obstacles never move. */
function standable(r, x) {
  if (r.type === 'grass') return !r.blocked.includes(x);
  if (r.type === 'ice') return r.floes[x - r.xMin];
  if (r.type === 'checkpoint') return Math.abs(x - r.gateX) <= 1;
  return true; // traffic, trains and logs always move out of the way eventually
}

/* Walk the world forward row by row: which columns can a player reach,
   hopping forward and sideways? An empty set means the run is a dead end. */
function firstSealedRow(rows, xMin, xMax) {
  let reach = null;
  for (const r of rows) {
    r.xMin = xMin;
    const next = new Set();
    for (let x = xMin; x <= xMax; x++) if ((!reach || reach.has(x)) && standable(r, x)) next.add(x);
    if (!next.size) return r.i;
    for (let pass = 0; pass < 2; pass++) {
      for (let x = xMin + 1; x <= xMax; x++) if (next.has(x - 1) && standable(r, x)) next.add(x);
      for (let x = xMax - 1; x >= xMin; x--) if (next.has(x + 1) && standable(r, x)) next.add(x);
    }
    reach = next;
  }
  return -1;
}

for (const seed of SEEDS) {
  test(`seed ${seed}: every generated row keeps the generator's promises`, async () => {
    const { rows, trackLen, xMin, xMax, startRow } = await survey(seed);

    for (let i = 0; i < 4; i++) {
      assert.equal(rows[i].type, 'grass', `row ${i} should be the safe back yard`);
      assert.equal(rows[i].decor, 0, `row ${i} should have no scenery`);
    }

    for (const r of rows) {
      const where = `seed ${seed} row ${r.i} (${r.type})`;

      if (r.type === 'grass') {
        assert.ok(r.free >= 4, `${where}: only ${r.free} free tiles`);
      }

      if (r.type === 'water') {
        assert.ok(r.items.length > 0, `${where}: no logs`);
        for (const gap of loopGaps(r.items, trackLen)) {
          assert.ok(gap <= 3.2 + 1e-9, `${where}: open-water gap ${gap.toFixed(2)} tiles`);
          assert.ok(gap >= 0, `${where}: logs overlap`);
        }
      }

      if (r.type === 'road' || r.type === 'parade') {
        assert.ok(r.items.length > 0, `${where}: empty lane`);
        for (const gap of loopGaps(r.items, trackLen)) {
          assert.ok(gap >= 0, `${where}: vehicles overlap (gap ${gap.toFixed(2)})`);
        }
      }

      if (r.type === 'ice') {
        let run = 0;
        r.floes.forEach(has => {
          run = has ? 0 : run + 1;
          assert.ok(run <= 2, `${where}: more than two missing floes in a row`);
        });
      }

      const metre = r.i - startRow;
      if (metre >= 50 && metre % 50 === 0) {
        assert.equal(r.type, 'checkpoint', `${where}: every 50th metre must be a sector border`);
      } else {
        assert.notEqual(r.type, 'checkpoint', `${where}: a sector border off the 50m marks`);
      }

      if (r.type === 'checkpoint') {
        assert.ok(r.gateX - 1 >= xMin && r.gateX + 1 <= xMax, `${where}: gate off the playfield`);
        assert.deepEqual(r.open, [r.gateX - 1, r.gateX, r.gateX + 1], `${where}: only the three gate tiles may pass`);
      }
    }

    assert.equal(firstSealedRow(rows, xMin, xMax), -1, `seed ${seed}: the way forward is sealed`);
  });
}

/* Sealed worlds are rare (a few percent of seeds before the fix, almost all
   at sector walls), so sweep many seeds in one page to be sure. */
test('no world is ever a dead end', async () => {
  const a = await openGame({ seed: 7 });
  const sealed = await a.eval((seeds) => {
    const W = PP.World, CFG = W.CFG, out = [];
    function mulberry(seed) {
      let s = seed >>> 0;
      return function () {
        s = (s + 0x6D2B79F5) >>> 0; let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    for (const seed of seeds) {
      Math.random = mulberry(seed);
      W.reset();
      let reach = null;
      for (let i = 0; i < 700; i++) {
        const r = W.row(i);
        const ok = x => !W.isBlocked(x, i) && (r.type !== 'ice' || !!r.floes[x]);
        const next = new Set();
        for (let x = CFG.X_MIN; x <= CFG.X_MAX; x++) if ((!reach || reach.has(x)) && ok(x)) next.add(x);
        if (!next.size) { out.push(seed + '@' + i); break; }
        for (let pass = 0; pass < 2; pass++) {
          for (let x = CFG.X_MIN + 1; x <= CFG.X_MAX; x++) if (next.has(x - 1) && ok(x)) next.add(x);
          for (let x = CFG.X_MAX - 1; x >= CFG.X_MIN; x--) if (next.has(x + 1) && ok(x)) next.add(x);
        }
        reach = next;
      }
    }
    return out;
  }, MANY_SEEDS);
  assert.deepEqual(sealed, []);
  await a.close();
});
