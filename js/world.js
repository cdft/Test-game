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
  var plan = { type: 'safe', left: 0, dirBias: 1 };
  var time = 0;

  /* ── Generation ─────────────────────────────────────────────────── */

  function difficulty(index) {
    return U.clamp(index / 190, 0, 1);
  }

  function nextType(index) {
    if (index < CFG.SAFE_ROWS) return 'safe';
    if (plan.left > 0) { plan.left--; return plan.type; }

    var d = difficulty(index);
    var table = [
      ['grass', 30 - d * 8],
      ['road', 34 + d * 12],
      ['water', 18 + d * 4],
      ['rail', 6 + d * 4]
    ];
    // Never repeat the same band twice in a row: it makes reading the
    // board hard and water-after-water is unfair at speed.
    var t = U.weighted(table.filter(function (e) { return e[0] !== plan.type; }));

    var len;
    if (t === 'road') len = U.randInt(1, d > 0.4 ? 4 : 3);
    else if (t === 'water') len = U.randInt(1, d > 0.5 ? 3 : 2);
    else if (t === 'rail') len = U.randInt(1, 2);
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

    var p = U.rand(0, CFG.TRACK_LEN);
    var out = [];
    for (i = 0; i < n; i++) {
      out.push(p);
      p += widths[i] + base + (jitter[i] - jsum / n) * amp;
    }
    return out;
  }

  function makeRoad(index) {
    var d = difficulty(index);
    var row = {
      index: index, type: 'road',
      dir: Math.random() < 0.5 ? -1 : 1,
      speed: U.rand(2.1, 3.3) + d * 3.4,
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
    var minGap = 2.4 + row.speed * 0.28;
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
    var type = nextType(index);
    switch (type) {
      case 'safe': return makeGrass(index, true);
      case 'grass': return makeGrass(index, false);
      case 'road': return makeRoad(index);
      case 'water': return makeWater(index);
      case 'rail': return makeRail(index);
    }
  }

  function rowAt(index) {
    if (index < 0) return null;
    var r = rows[index];
    if (r) return r;
    // Generate in order so the band planner stays coherent.
    for (var i = maxGenerated + 1; i <= index; i++) {
      rows[i] = generate(i);
      maxGenerated = i;
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

    reset: function () {
      for (var k in rows) if (Object.prototype.hasOwnProperty.call(rows, k)) delete rows[k];
      maxGenerated = -1;
      plan = { type: 'safe', left: 0, dirBias: 1 };
      time = 0;
      // Prime the opening stretch.
      for (var i = 0; i <= CFG.SAFE_ROWS + 6; i++) rowAt(i);
    },

    time: function () { return time; },
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

        if (r.type === 'road') {
          for (j = 0; j < r.cars.length; j++) r.cars[j].p += r.speed * dt;
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
      if (!r || r.type !== 'road') return null;
      for (var i = 0; i < r.cars.length; i++) {
        var car = r.cars[i];
        var cx = carX(r, car);
        if (Math.abs(cx - x) < car.w / 2 + halfWidth) return car;
      }
      return null;
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
