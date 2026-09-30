/* Endless row generator + simulation. The world is an infinite ribbon of
   rows; row 0 is the back yard you start in and every row forward is one
   metre closer to the border. Rows are generated lazily and pruned behind. */
(function (global) {
  'use strict';

  var PP = global.PP;
  var U = PP.U;

  var CFG = {
    // The playfield is narrow enough that both edges stay on screen even
    // when the camera is clamped, so nothing important happens out of sight.
    X_MIN: -7,          // leftmost tile the player may occupy
    X_MAX: 7,           // rightmost
    TRACK_MIN: -14,     // where traffic and logs spawn/despawn
    TRACK_MAX: 14,
    SAFE_ROWS: 4,       // opening rows with nothing in them
    START_ROW: 2,       // where you stand at the start: this is metre 0
    AHEAD: 26,          // rows kept generated in front of the player
    BEHIND: 14          // rows kept alive behind the player
  };
  CFG.TRACK_LEN = CFG.TRACK_MAX - CFG.TRACK_MIN;

  var CAR_KINDS = [
    { kind: 'truck', w: 2.5, weight: 3, color: '#8f2f2f' },
    { kind: 'jeep', w: 1.9, weight: 3, color: '#4c5a3a' },
    { kind: 'sedan', w: 2.0, weight: 2, color: '#22242a' },
    { kind: 'tractor', w: 2.2, weight: 2, color: '#c8102e' },
    { kind: 'tank', w: 3.0, weight: 1, color: '#5a5f4c' }
  ];

  var rows = {};        // index -> row object
  var maxGenerated = -1;
  var seed = 0;         // this world's seed: same seed, same world
  var worldRandom = Math.random;
  var reach = null;     // columns reachable on the newest generated row
  var plan = { type: 'safe', left: 0, dirBias: 1 };
  var time = 0;

  /* ── Generation ─────────────────────────────────────────────────── */

  function difficulty(index) {
    return U.clamp(index / 320, 0, 1);
  }

  function nextType(index) {
    if (index < CFG.SAFE_ROWS) return 'safe';
    if (plan.left > 0) { plan.left--; return plan.type; }

    var d = difficulty(index);
    var table = [
      ['grass', 30 - d * 8],
      ['road', 30 + d * 10],
      ['water', 16 + d * 3],
      ['rail', 6 + d * 4],
      ['parade', index > 12 ? 7 + d * 5 : 0],
      ['ice', index > 25 ? 8 + d * 5 : 0]
    ];
    // Never repeat the same band twice in a row: it makes reading the
    // board hard and water-after-water is unfair at speed.
    var t = U.weighted(table.filter(function (e) { return e[0] !== plan.type; }));

    var len;
    if (t === 'road') len = U.randInt(1, d > 0.6 ? 4 : 3);
    else if (t === 'water') len = U.randInt(1, d > 0.5 ? 3 : 2);
    else if (t === 'rail') len = U.randInt(1, 2);
    else if (t === 'parade') len = 1;
    else if (t === 'ice') len = U.randInt(1, d > 0.5 ? 2 : 1);
    else len = U.randInt(1, 2);

    plan.type = t;
    plan.left = len - 1;
    return t;
  }

  function makeGrass(index, safe) {
    var d = difficulty(index);
    var row = { index: index, type: 'grass', decor: [], blocked: {}, coin: null };
    var free = [];
    var x;
    for (x = CFG.X_MIN; x <= CFG.X_MAX; x++) free.push(x);

    if (!safe) {
      var count = U.randInt(1, 3 + Math.round(d * 3));
      for (var i = 0; i < count && free.length > 5; i++) {
        var pick = U.randInt(0, free.length - 1);
        x = free.splice(pick, 1)[0];
        row.blocked[x] = true;
        row.decor.push({
          x: x,
          kind: U.weighted([['tree', 6], ['bush', 3], ['rock', 2], ['bust', 1.2], ['banner', 1]]),
          h: U.rand(0.8, 1.7),
          seed: Math.random()
        });
      }
      if (Math.random() < 0.35 && free.length) {
        row.coin = { x: free[U.randInt(0, free.length - 1)], taken: false, bob: Math.random() * 6 };
      }
    } else if (index === 0) {
      row.fence = true;   // the garden gate you are leaving behind
    }
    return row;
  }

  /* Lay items out around the loop so that the gaps sum to exactly one lap.
     Everything wraps forever after that, which means spacing is preserved,
     items never overlap, and there is no giant hole at the seam.
     `widths` is truncated in place if the items cannot all fit. */
  function layout(widths, minGap, maxGap, grow) {
    var i, sum = 0;
    for (i = 0; i < widths.length; i++) sum += widths[i];
    // Too few items would leave gaps wider than maxGap; too many won't fit.
    while (grow && widths.length < 14 && (CFG.TRACK_LEN - sum) / widths.length > maxGap) {
      var extra = grow();
      widths.push(extra);
      sum += extra;
    }
    while (widths.length > 1 && (CFG.TRACK_LEN - sum) / widths.length < minGap) {
      sum -= widths.pop();
    }

    var n = widths.length;
    var base = U.clamp((CFG.TRACK_LEN - sum) / n, minGap, maxGap);

    // Jitter the gaps, with the jitters summing to zero so the lap still closes.
    var jitter = [], jsum = 0;
    for (i = 0; i < n; i++) { var v = U.rand(-1, 1); jitter.push(v); jsum += v; }
    var amp = Math.max(0, Math.min(base - minGap, maxGap - base)) * 0.45;

    // Positions are item centres, so the step to the next item is half of
    // each width plus the gap between them.
    var p = U.rand(0, CFG.TRACK_LEN);
    var out = [];
    for (i = 0; i < n; i++) {
      out.push(p);
      p += (widths[i] + widths[(i + 1) % n]) / 2 + base + (jitter[i] - jsum / n) * amp;
    }
    return out;
  }

  function makeRoad(index) {
    var d = difficulty(index);
    var row = {
      index: index, type: 'road',
      dir: Math.random() < 0.5 ? -1 : 1,
      speed: U.rand(2.1, 3.2) + d * 2.2,
      cars: []
    };

    var count = U.randInt(2, 3 + Math.round(d * 2));
    var kinds = [], widths = [], i;
    for (i = 0; i < count; i++) {
      var kind = U.weighted(CAR_KINDS.map(function (k) { return [k, k.weight]; }));
      kinds.push(kind);
      widths.push(kind.w);
    }
    // Traffic thins out as it speeds up, so every lane stays crossable.
    var minGap = 2.6 + row.speed * 0.34;
    var ps = layout(widths, minGap, minGap + 4.5, function () {
      var k = U.weighted(CAR_KINDS.map(function (c) { return [c, c.weight]; }));
      kinds.push(k);
      return k.w;
    });
    for (i = 0; i < ps.length; i++) {
      row.cars.push({
        p: ps[i], w: kinds[i].w, kind: kinds[i].kind, color: kinds[i].color,
        skin: U.randInt(0, 3), seed: Math.random()
      });
    }
    return row;
  }

  function makeWater(index) {
    var d = difficulty(index);
    var row = {
      index: index, type: 'water',
      dir: Math.random() < 0.5 ? -1 : 1,
      speed: U.rand(1.0, 1.8) + d * 1.2,
      logs: []
    };

    var count = U.randInt(5, 7);
    var widths = [], i;
    for (i = 0; i < count; i++) widths.push(U.pick([2, 3, 3, 4]));
    // Open water never exceeds ~3 tiles, so a log is always on its way.
    var ps = layout(widths, 1.5, 3.1, function () { return U.pick([2, 3]); });
    for (i = 0; i < ps.length; i++) {
      row.logs.push({
        p: ps[i], w: widths[i],
        kind: Math.random() < 0.25 ? 'raft' : 'log',
        seed: Math.random()
      });
    }
    return row;
  }

  /* A May Day column: squads of marchers crossing like slow, wide,
     very committed vehicles. Touching one doesn't squash you — it
     recruits you. */
  function makeParade(index) {
    var d = difficulty(index);
    var row = {
      index: index, type: 'parade',
      dir: Math.random() < 0.5 ? -1 : 1,
      speed: U.rand(1.0, 1.5) + d * 0.8,
      cars: []
    };
    var count = U.randInt(3, 4);
    var widths = [], i;
    for (i = 0; i < count; i++) widths.push(U.pick([2.2, 2.8, 3.4]));
    var ps = layout(widths, 1.7, 3.2, function () { return U.pick([2.2, 2.8]); });
    for (i = 0; i < ps.length; i++) {
      row.cars.push({
        p: ps[i], w: widths[i], kind: 'squad',
        skin: U.randInt(0, 3), seed: Math.random()
      });
    }
    return row;
  }

  /* A frozen river: static floes you can stand on — briefly. Weight on a
     floe cracks it, then sinks it; it bobs back up once you're gone. */
  function makeIce(index) {
    var row = { index: index, type: 'ice', floes: {} };
    var run = 0;
    for (var x = CFG.X_MIN; x <= CFG.X_MAX; x++) {
      if (Math.random() < 0.3 && run < 2) { run++; continue; }
      run = 0;
      row.floes[x] = { state: 'solid', standT: 0, recoverT: 0, pressed: false, seed: Math.random() };
    }
    return row;
  }

  /* Every 50th metre: a sector border. Concrete wall, barbed wire, one
     open gate. The wall blocks everything but the gate tiles. */
  function makeCheckpoint(index) {
    // Put the gate somewhere the row behind it can actually get to.
    var options = [];
    for (var gx = CFG.X_MIN + 2; gx <= CFG.X_MAX - 2; gx++) {
      if (!reach || reach[gx - 1] || reach[gx] || reach[gx + 1]) options.push(gx);
    }
    var gateX;
    if (options.length) {
      gateX = U.pick(options);
    } else {
      // Only an edge column is reachable (the gate cannot sit there): put
      // the gate as close as it goes and open the approach beside it.
      var edge = reach[CFG.X_MAX] ? CFG.X_MAX : CFG.X_MIN;
      var side = edge > 0 ? 1 : -1;
      gateX = edge - side * 2;
      var before = rows[index - 1];
      if (before) open(before, edge - side);
      reach[edge - side] = true;
    }
    return { index: index, type: 'checkpoint', gateX: gateX, seed: Math.random() };
  }

  function makeRail(index) {
    return {
      index: index, type: 'rail',
      dir: Math.random() < 0.5 ? -1 : 1,
      state: 'idle',
      timer: U.rand(1.2, 4.0),
      trainX: 0,
      trainW: U.rand(9, 15),
      speed: 26 + difficulty(index) * 10,
      lit: 0
    };
  }

  function generate(index) {
    // Sector borders land on the round numbers, interrupting whatever
    // band was in progress — walls don't care about your plans.
    var metre = index - CFG.START_ROW;
    if (metre >= 50 && metre % 50 === 0) return makeCheckpoint(index);
    var type = nextType(index);
    switch (type) {
      case 'safe': return makeGrass(index, true);
      case 'grass': return makeGrass(index, false);
      case 'road': return makeRoad(index);
      case 'water': return makeWater(index);
      case 'rail': return makeRail(index);
      case 'parade': return makeParade(index);
      case 'ice': return makeIce(index);
    }
  }

  /* ── Guaranteed passage ─────────────────────────────────────────────
     Grass scenery, missing floes and sector walls are the only things that
     never move out of your way. As each row is generated we track which
     columns can be reached from the start, and if a row would seal the
     way forward we open a tile in it. No world is ever a dead end. */

  function standable(row, x) {
    if (row.type === 'grass') return !row.blocked[x];
    if (row.type === 'ice') return !!row.floes[x];
    if (row.type === 'checkpoint') return Math.abs(x - row.gateX) <= 1;
    return true;   // traffic and logs always move on eventually
  }

  function open(row, x) {
    if (row.type === 'grass') {
      delete row.blocked[x];
      row.decor = row.decor.filter(function (dc) { return dc.x !== x; });
    } else if (row.type === 'ice') {
      row.floes[x] = { state: 'solid', standT: 0, recoverT: 0, pressed: false, seed: Math.random() };
    }
  }

  function settle(row) {
    var x, next = {}, any = false;
    if (reach) {
      for (x = CFG.X_MIN; x <= CFG.X_MAX; x++) {
        if (reach[x] && standable(row, x)) { next[x] = true; any = true; }
      }
      if (!any) {
        // Sealed: open the reachable column nearest the middle.
        var best = null;
        for (x = CFG.X_MIN; x <= CFG.X_MAX; x++) {
          if (reach[x] && (best === null || Math.abs(x) < Math.abs(best))) best = x;
        }
        open(row, best);
        next[best] = true;
      }
    } else {
      for (x = CFG.X_MIN; x <= CFG.X_MAX; x++) if (standable(row, x)) next[x] = true;
    }
    // Sideways along the row, through anything standable.
    for (var pass = 0; pass < 2; pass++) {
      for (x = CFG.X_MIN + 1; x <= CFG.X_MAX; x++) if (next[x - 1] && standable(row, x)) next[x] = true;
      for (x = CFG.X_MAX - 1; x >= CFG.X_MIN; x--) if (next[x + 1] && standable(row, x)) next[x] = true;
    }
    reach = next;
    return row;
  }

  /* A small seeded generator (mulberry32). The world draws only from this,
     so the same seed always lays out the same roads, rivers and walls, no
     matter what else in the game rolls dice in between. */
  function seeded(a) {
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rowAt(index) {
    if (index < 0) return null;
    var r = rows[index];
    if (r) return r;
    // Generate in order so the band planner stays coherent, and from the
    // world's own dice.
    var outside = Math.random;
    Math.random = worldRandom;
    try {
      for (var i = maxGenerated + 1; i <= index; i++) {
        rows[i] = settle(generate(i));
        maxGenerated = i;
      }
    } finally {
      Math.random = outside;
    }
    return rows[index];
  }

  /* ── Queries ────────────────────────────────────────────────────── */

  function carX(row, car) {
    var p = U.mod(car.p, CFG.TRACK_LEN);
    return row.dir > 0 ? CFG.TRACK_MIN + p : CFG.TRACK_MAX - p;
  }

  function logX(row, lg) {
    var p = U.mod(lg.p, CFG.TRACK_LEN);
    return row.dir > 0 ? CFG.TRACK_MIN + p : CFG.TRACK_MAX - p;
  }

  var World = {
    CFG: CFG,
    rows: rows,

    /* A fresh world. Pass a seed to get a particular one (the Daily Escape
       uses the date); leave it out for a random one. */
    reset: function (worldSeed) {
      seed = worldSeed === undefined ? Math.floor(Math.random() * 4294967296) >>> 0 : worldSeed >>> 0;
      worldRandom = seeded(seed);
      for (var k in rows) if (Object.prototype.hasOwnProperty.call(rows, k)) delete rows[k];
      maxGenerated = -1;
      reach = null;
      plan = { type: 'safe', left: 0, dirBias: 1 };
      time = 0;
      // Prime the opening stretch.
      for (var i = 0; i <= CFG.SAFE_ROWS + 6; i++) rowAt(i);
    },

    time: function () { return time; },
    seed: function () { return seed; },
    row: rowAt,
    difficulty: difficulty,
    carX: carX,
    logX: logX,

    update: function (dt, playerRow) {
      time += dt;
      var lo = Math.floor(playerRow) - CFG.BEHIND;
      var hi = Math.floor(playerRow) + CFG.AHEAD;
      var i, r, j;

      for (i = Math.max(0, lo); i <= hi; i++) {
        r = rowAt(i);
        if (!r) continue;

        if (r.type === 'road' || r.type === 'parade') {
          for (j = 0; j < r.cars.length; j++) r.cars[j].p += r.speed * dt;
        } else if (r.type === 'ice') {
          for (var fk in r.floes) {
            var fl = r.floes[fk];
            if (fl.state === 'sunk') {
              fl.recoverT -= dt;
              if (fl.recoverT <= 0) { fl.state = 'solid'; fl.standT = 0; }
            } else if (!fl.pressed && fl.standT > 0) {
              fl.standT = Math.max(0, fl.standT - dt * 1.4);
              if (fl.standT < 0.8) fl.state = 'solid';
            }
            fl.pressed = false;
          }
        } else if (r.type === 'water') {
          for (j = 0; j < r.logs.length; j++) r.logs[j].p += r.speed * dt;
        } else if (r.type === 'rail') {
          r.timer -= dt;
          if (r.state === 'idle') {
            if (r.timer <= 0) {
              r.state = 'warn';
              r.timer = 1.35;
              r.lit = 0;
              if (Math.abs(i - playerRow) < 9) PP.Audio.horn();
            }
          } else if (r.state === 'warn') {
            r.lit += dt;
            if (r.timer <= 0) {
              r.state = 'train';
              r.trainX = r.dir > 0 ? CFG.TRACK_MIN - r.trainW : CFG.TRACK_MAX + r.trainW;
            }
          } else {
            r.trainX += r.dir * r.speed * dt;
            var done = r.dir > 0
              ? r.trainX - r.trainW / 2 > CFG.TRACK_MAX
              : r.trainX + r.trainW / 2 < CFG.TRACK_MIN;
            if (done) {
              r.state = 'idle';
              r.timer = U.rand(2.2, 5.0);
            }
          }
        }
      }

      // Prune what nobody can see any more.
      for (var key in rows) {
        if (Object.prototype.hasOwnProperty.call(rows, key) && (+key) < lo - 4) delete rows[key];
      }
    },

    /* Is this tile walkable? Off-map and scenery both block. */
    isBlocked: function (x, rowIndex) {
      if (x < CFG.X_MIN || x > CFG.X_MAX) return true;
      var r = rowAt(rowIndex);
      if (!r) return true;
      if (r.type === 'checkpoint') return Math.abs(x - r.gateX) > 1;
      return r.type === 'grass' && !!r.blocked[x];
    },

    /* The log/raft under this point, or null. A landing that catches the very
       end of a log counts — the alternative is losing runs to a few pixels. */
    logUnder: function (x, rowIndex) {
      var r = rowAt(rowIndex);
      if (!r || r.type !== 'water') return null;
      for (var i = 0; i < r.logs.length; i++) {
        var lg = r.logs[i];
        var lx = logX(r, lg);
        if (x > lx - lg.w / 2 - 0.45 && x < lx + lg.w / 2 + 0.45) return lg;
      }
      return null;
    },

    /* A vehicle overlapping this point, or null. */
    carAt: function (x, rowIndex, halfWidth) {
      var r = rowAt(rowIndex);
      if (!r || (r.type !== 'road' && r.type !== 'parade')) return null;
      for (var i = 0; i < r.cars.length; i++) {
        var car = r.cars[i];
        var cx = carX(r, car);
        if (Math.abs(cx - x) < car.w / 2 + halfWidth) return car;
      }
      return null;
    },

    /* The floe under this tile, or null. */
    floeAt: function (x, rowIndex) {
      var r = rowAt(rowIndex);
      if (!r || r.type !== 'ice') return null;
      return r.floes[Math.round(x)] || null;
    },

    trainAt: function (x, rowIndex, halfWidth) {
      var r = rowAt(rowIndex);
      if (!r || r.type !== 'rail' || r.state !== 'train') return false;
      return Math.abs(r.trainX - x) < r.trainW / 2 + halfWidth;
    },

    coinAt: function (x, rowIndex) {
      var r = rowAt(rowIndex);
      if (!r || !r.coin || r.coin.taken || r.coin.x !== x) return null;
      return r.coin;
    }
  };

  PP.World = World;
})(window);
