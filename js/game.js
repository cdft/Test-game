/* Game state, player physics, the chase, and the run loop. */
(function (global) {
  'use strict';

  var PP = global.PP;
  var U = PP.U;
  var World = PP.World;

  var HOP_TIME = 0.135;       // seconds per hop
  var HOP_LIFT = 0.34;        // tiles of arc height
  var HALF_W = 0.38;          // player half-width for vehicle collisions
  var COIN_VALUE = 5;
  var IDLE_GRACE = 3.0;       // seconds of standing still before the tide surges
  var DEATH_HOLD = 1.6;       // seconds between dying and the game-over card
  var CAUGHT_HOLD = 3.0;      // longer, so you get to watch yourself convert
  var CONVERT_TIME = 1.3;     // seconds to go from pet to comrade

  /* What the Collective turns you into. */
  var REGIME = { fur: '#6b6f78', belly: '#9aa0a8', accent: '#c8102e', eye: '#1a1a1a' };

  var SAVE_KEY = 'pp.save';

  var save = U.store.get(SAVE_KEY, null) || {
    best: 0, coins: 0, runs: 0, owned: ['mittens', 'biscuit'], char: 'mittens'
  };
  if (!save.owned || !save.owned.length) save.owned = ['mittens', 'biscuit'];
  save.dodges = save.dodges || 0;
  save.hops = save.hops || 0;

  function persist() { U.store.set(SAVE_KEY, save); }

  /* ── State Directives ─────────────────────────────────────────────
     Three rotating objectives. Complete one mid-run and the bounty is
     paid on the spot; a fresh directive replaces it next run. */

  var D_TEMPLATES = [
    { id: 'dist30', label: 'Reach 30m in one run', type: 'dist', target: 30, reward: 40 },
    { id: 'dist50', label: 'Reach 50m in one run', type: 'dist', target: 50, reward: 60 },
    { id: 'dist80', label: 'Reach 80m in one run', type: 'dist', target: 80, reward: 90 },
    { id: 'coins15', label: 'Pocket 15 kibble in one run', type: 'coins', target: 15, reward: 40 },
    { id: 'rivers4', label: 'Cross 4 canals in one run', type: 'rivers', target: 4, reward: 40 },
    { id: 'ice3', label: 'Cross 3 frozen rows in one run', type: 'ice', target: 3, reward: 50 },
    { id: 'parade2', label: 'Slip past 2 parades in one run', type: 'parade', target: 2, reward: 50 },
    { id: 'dodge1', label: 'Dodge the black car', type: 'dodge', target: 1, reward: 60 },
    { id: 'hops500', label: 'Hop 500 times, in total', type: 'hops', target: 500, reward: 50 },
    { id: 'record', label: 'Break your record', type: 'record', target: 1, reward: 50 }
  ];

  function templateById(id) {
    for (var i = 0; i < D_TEMPLATES.length; i++) if (D_TEMPLATES[i].id === id) return D_TEMPLATES[i];
    return null;
  }

  function pickDirective(exceptIds) {
    var pool = D_TEMPLATES.filter(function (tpl) {
      return exceptIds.indexOf(tpl.id) === -1;
    });
    return pool[U.randInt(0, pool.length - 1)];
  }

  function ensureDirectives() {
    if (save.directives && save.directives.length === 3) return;
    save.directives = [];
    for (var i = 0; i < 3; i++) {
      var have = save.directives.map(function (d) { return d.id; });
      save.directives.push({ id: pickDirective(have).id, done: false });
    }
    persist();
  }

  function refreshDirectives() {
    var changed = false;
    for (var i = 0; i < save.directives.length; i++) {
      if (save.directives[i].done) {
        var have = save.directives.map(function (d) { return d.id; });
        save.directives[i] = { id: pickDirective(have).id, done: false };
        changed = true;
      }
    }
    if (changed) persist();
  }

  function directiveValue(tpl) {
    switch (tpl.type) {
      case 'dist': return g.score;
      case 'coins': return g.runStats.kibble;
      case 'rivers': return g.runStats.waterX;
      case 'ice': return g.runStats.iceX;
      case 'parade': return g.runStats.paradeX;
      case 'dodge': return g.runStats.dodged ? 1 : 0;
      case 'hops': return save.hops;
      case 'record': return g.bestCrossed ? 1 : 0;
    }
    return 0;
  }

  function checkDirectives() {
    if (g.mode !== 'playing') return;
    for (var i = 0; i < save.directives.length; i++) {
      var d = save.directives[i];
      if (d.done) continue;
      var tpl = templateById(d.id);
      if (!tpl) continue;
      if (directiveValue(tpl) >= tpl.target) {
        d.done = true;
        persist();
        g.runCoins += tpl.reward;
        floater('DIRECTIVE +' + tpl.reward, g.player.x, g.player.row + 1.0, '#8ee36a');
        PP.Audio.unlockChime();
      }
    }
  }

  var g = {
    mode: 'menu',              // menu | playing | paused | dying | dead
    cam: { x: 0, row: 2 },
    player: null,
    tide: { row: -7, speed: 1.2 },
    particles: [],
    floaters: [],
    splashes: [],
    playerChar: null,          // set while converting; render prefers it
    shake: 0,
    flash: 0,
    showPlayer: false,
    char: PP.Characters.byId(save.char),
    score: 0,
    runCoins: 0,
    idleT: 0,
    deathT: 0,
    nextMilestone: 25,
    bestLineRow: -1,           // where the record line sits for this run
    bestCrossed: false,
    van: { state: 'idle', t: 0, x: 0, row: 0, fromSide: 1, caught: false },
    runStats: { waterX: 0, iceX: 0, paradeX: 0, kibble: 0, dodged: false },
    streak: 0,
    lastFwdT: -9,
    slowmoT: 0,
    queued: null,
    onDeath: null,             // set by main.js
    onScore: null
  };

  function newPlayer() {
    return {
      x: 0, row: 2,
      fromX: 0, fromRow: 2, toX: 0, toRow: 2,
      hopping: false, hopT: 0,
      facing: 'up', squash: 0, lift: 0,
      onLog: null, charging: false,
      dead: false, deathKind: null, sinkT: 0,
      convertT: 0, marchT: 0,
      bumpT: 0
    };
  }

  /* Blend the player's colours toward the regime's as they are converted. */
  function convertedChar(base, t) {
    return {
      species: base.species, ears: base.ears, tail: base.tail,
      short: base.short, fluffy: base.fluffy,
      fur: U.mixHex(base.fur, REGIME.fur, t),
      belly: U.mixHex(base.belly, REGIME.belly, t),
      accent: U.mixHex(base.accent, REGIME.accent, t),
      eye: U.mixHex(base.eye, REGIME.eye, t)
    };
  }

  /* ── Effects ────────────────────────────────────────────────────── */

  function puff(x, row, color, count, spread) {
    for (var i = 0; i < count; i++) {
      g.particles.push({
        x: x + U.rand(-0.25, 0.25),
        row: row + U.rand(-0.2, 0.2),
        z: U.rand(0.1, 0.4),
        vx: U.rand(-spread, spread),
        vrow: U.rand(-spread * 0.6, spread * 0.6),
        vz: U.rand(0.6, 2.2),
        size: U.rand(0.02, 0.06),
        color: color,
        shape: Math.random() < 0.5 ? 'circle' : 'square',
        life: U.rand(0.4, 0.9),
        maxLife: 0.9
      });
    }
  }

  /* Rings on the surface plus droplets thrown clear of the impact. */
  function splash(x, row) {
    g.splashes.push({ x: x, row: row, t: 0, maxT: 1.1 });
    for (var i = 0; i < 22; i++) {
      var a = Math.random() * Math.PI * 2;
      var speed = U.rand(0.7, 2.4);
      g.particles.push({
        x: x, row: row, z: 0.05,
        vx: Math.cos(a) * speed,
        vrow: Math.sin(a) * speed * 0.45,
        vz: U.rand(1.8, 4.2),
        size: U.rand(0.018, 0.055),
        color: i % 3 === 0 ? 'rgba(255,255,255,0.95)' : 'rgba(168,214,240,0.95)',
        shape: 'circle',
        life: U.rand(0.5, 1.0),
        maxLife: 1.0
      });
    }
  }

  function floater(text, x, row, color) {
    g.floaters.push({ text: text, x: x, row: row, life: 1.0, maxLife: 1.0, color: color });
  }

  function updateEffects(dt) {
    var i, p;
    for (i = g.particles.length - 1; i >= 0; i--) {
      p = g.particles[i];
      p.life -= dt;
      if (p.life <= 0) { g.particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.row += p.vrow * dt;
      p.z += p.vz * dt;
      p.vz -= 7 * dt;
      if (p.z < 0) { p.z = 0; p.vz *= -0.35; }
    }
    for (i = g.floaters.length - 1; i >= 0; i--) {
      g.floaters[i].life -= dt * 0.9;
      if (g.floaters[i].life <= 0) g.floaters.splice(i, 1);
    }
    for (i = g.splashes.length - 1; i >= 0; i--) {
      g.splashes[i].t += dt;
      if (g.splashes[i].t >= g.splashes[i].maxT) g.splashes.splice(i, 1);
    }
    g.shake = Math.max(0, g.shake - dt * 2.2);
    g.flash = Math.max(0, g.flash - dt * 3.0);
  }

  /* ── Movement ───────────────────────────────────────────────────── */

  function tryMove(dir) {
    if (g.mode !== 'playing') return;
    var p = g.player;
    if (p.dead) return;
    p.charging = false;

    if (p.hopping) {
      // Late input is buffered so chained hops feel responsive.
      if (p.hopT / HOP_TIME > 0.55) g.queued = dir;
      return;
    }

    var baseX = Math.round(p.x);
    var toX = baseX, toRow = p.row;
    if (dir === 'up') toRow = p.row + 1;
    else if (dir === 'down') toRow = p.row - 1;
    else if (dir === 'left') toX = baseX - 1;
    else if (dir === 'right') toX = baseX + 1;

    p.facing = dir;

    var blocked = World.isBlocked(toX, toRow) || toRow < 0 || toRow <= Math.ceil(g.tide.row);
    if (blocked) {
      p.bumpT = 0.12;
      p.squash = 0.22;
      PP.Audio.bump();
      return;
    }

    p.fromX = p.x;
    p.fromRow = p.row;
    p.toX = toX;
    p.toRow = toRow;
    p.hopping = true;
    p.hopT = 0;
    p.onLog = null;
    if (dir === 'up') {
      g.idleT = 0;
      var nowT = World.time();
      g.streak = (nowT - g.lastFwdT < 0.9) ? g.streak + 1 : 1;
      g.lastFwdT = nowT;
    }
    save.hops++;
    PP.Audio.hop(g.char.species === 'cat' ? 1.12 : 0.85);
  }

  function land() {
    var p = g.player;
    p.x = p.toX;
    p.row = p.toRow;
    p.hopping = false;
    p.lift = 0;
    p.squash = -0.22;

    var row = World.row(p.row);
    if (row && row.type === 'grass') puff(p.x, p.row, 'rgba(140,200,120,0.9)', 4, 1.1);
    if (row && row.type === 'water') {
      var lg = World.logUnder(p.x, p.row);
      if (lg) {
        p.onLog = lg;
        puff(p.x, p.row, 'rgba(190,225,245,0.9)', 5, 1.2);
        g.splashes.push({ x: p.x, row: p.row, t: 0, maxT: 0.5, kind: 'ripple' });
      }
    } else if (row && row.type === 'ice') {
      g.splashes.push({ x: p.x, row: p.row, t: 0, maxT: 0.45, kind: 'ripple' });
      PP.Audio.iceLand();
    } else if (row) {
      // A little kick of dust marks every landing on solid ground.
      g.splashes.push({ x: p.x, row: p.row, t: 0, maxT: 0.38, kind: 'dust' });
    }

    // Crossing your own record line is a moment.
    if (!g.bestCrossed && g.bestLineRow >= 3 && p.row > g.bestLineRow) {
      g.bestCrossed = true;
      floater('RECORD BROKEN', p.x, p.row + 0.6, '#f5c542');
      puff(p.x, p.row, '#f5c542', 16, 2.6);
      PP.Audio.milestone();
      checkDirectives();
    }

    var coin = World.coinAt(Math.round(p.x), p.row);
    if (coin) {
      coin.taken = true;
      var mult = g.streak >= 10 ? 2 : 1;   // momentum pays double
      g.runCoins += COIN_VALUE * mult;
      g.runStats.kibble += COIN_VALUE * mult;
      floater('+' + (COIN_VALUE * mult), p.x, p.row, '#f5c542');
      puff(p.x, p.row, '#f5c542', 8, 1.6);
      PP.Audio.coin();
      checkDirectives();
    }

    if (p.row > g.score) {
      g.score = p.row;
      // The row now fully behind you counts as crossed.
      var behind = World.row(g.score - 1);
      if (behind) {
        if (behind.type === 'water') g.runStats.waterX++;
        else if (behind.type === 'ice') g.runStats.iceX++;
        else if (behind.type === 'parade') g.runStats.paradeX++;
        else if (behind.type === 'checkpoint') {
          // Through the gate: the paperwork delays them.
          g.runCoins += 25;
          g.tide.row = Math.max(-7, g.tide.row - 2);
          floater('SECTOR CLEARED +25', p.x, p.row + 1.0, '#f5c542');
          g.flash = 0.22;
          PP.Audio.fanfare();
        }
      }
      checkDirectives();
      if (g.onScore) g.onScore(g.score);
      if (g.score >= g.nextMilestone) {
        g.nextMilestone += 25;
        floater(g.score + 'm', p.x, p.row + 0.4, '#ffffff');
        PP.Audio.milestone();
      }
    }

    if (g.queued) {
      var q = g.queued;
      g.queued = null;
      tryMove(q);
    }
  }

  function updatePlayer(dt) {
    var p = g.player;

    if (p.dead) {
      if (p.deathKind === 'water') p.sinkT = Math.min(1, p.sinkT + dt * 1.4);
      if (p.deathKind === 'van') p.sinkT = Math.min(1, p.sinkT + dt * 1.8);
      if (p.deathKind === 'caught') {
        // Re-education: the colours drain, the hat arrives, and you fall in
        // step with the rank you were running from.
        var was = p.convertT;
        p.convertT = Math.min(1, p.convertT + dt / CONVERT_TIME);
        p.marchT += dt;
        g.playerChar = convertedChar(g.char, p.convertT);
        if (p.convertT > 0.45) p.facing = 'up';
        if (was < 0.5 && p.convertT >= 0.5) {
          floater('COMRADE', p.x, p.row + 1.25, '#f5c542');
          puff(p.x, p.row, '#c8102e', 10, 1.8);
        }
      }
      return;
    }

    p.bumpT = Math.max(0, p.bumpT - dt);
    p.squash = U.approach(p.squash, 0, 14, dt);

    if (p.hopping) {
      p.hopT += dt;
      var t = U.clamp(p.hopT / HOP_TIME, 0, 1);
      p.x = U.lerp(p.fromX, p.toX, t);
      p.row = U.lerp(p.fromRow, p.toRow, t);
      p.lift = Math.sin(t * Math.PI) * HOP_LIFT;
      p.squash = Math.sin(t * Math.PI) * 0.18;
      if (t >= 1) land();
    } else {
      // Riding: logs carry you, and the current does not care where you wanted to go.
      var row = World.row(p.row);
      if (row && row.type === 'water') {
        var lg = World.logUnder(p.x, p.row);
        p.onLog = lg;
        if (lg) p.x += row.dir * row.speed * dt;
      } else if (row && row.type === 'ice') {
        // Your weight is a problem the floe intends to solve.
        var floe = World.floeAt(p.x, p.row);
        if (floe && floe.state !== 'sunk') {
          floe.pressed = true;
          floe.standT += dt;
          if (floe.standT > 1.6) {
            floe.state = 'sunk';
            floe.recoverT = 2.6;
            PP.Audio.iceBreak();
          } else if (floe.standT > 0.8 && floe.state === 'solid') {
            floe.state = 'cracking';
            PP.Audio.iceCrack();
          }
        }
      }
    }

    checkDeath();
  }

  function die(kind) {
    var p = g.player;
    if (p.dead) return;
    p.dead = true;
    p.deathKind = kind;
    p.hopping = false;
    g.mode = 'dying';
    g.deathT = 0;
    // A beat of slow motion sells the impact; conversion is already slow.
    if (kind !== 'caught') g.slowmoT = 0.45;

    if (kind === 'squash') {
      g.shake = 1;
      g.flash = 0.5;
      puff(p.x, p.row, g.char.fur, 16, 3.2);
      PP.Audio.squash();
      PP.Music.fadeOut(0.5);
    } else if (kind === 'water') {
      splash(p.x, p.row);
      g.shake = 0.35;
      PP.Audio.splash();
      PP.Music.fadeOut(0.5);
    } else if (kind === 'van') {
      g.shake = 0.45;
      puff(p.x, p.row, g.char.fur, 10, 2.0);
      PP.Audio.doorSlam();
      PP.Music.fadeOut(0.5);
    } else {
      g.shake = 0.7;
      puff(p.x, p.row, '#c8102e', 18, 2.6);
      PP.Audio.caught();
      PP.Music.stop();
      PP.Music.victoryOfTheCollective();
    }
  }

  function checkDeath() {
    var p = g.player;
    var row = World.row(p.row);
    if (!row) return;

    if (g.tide.row >= p.row - 0.05) { die('caught'); return; }

    if (row.type === 'road' && World.carAt(p.x, p.row, HALF_W)) { die('squash'); return; }
    if (row.type === 'parade' && World.carAt(p.x, p.row, HALF_W)) { die('caught'); return; }
    if (row.type === 'rail' && World.trainAt(p.x, p.row, HALF_W)) { die('squash'); return; }

    if (row.type === 'ice' && !p.hopping) {
      var fl = World.floeAt(p.x, p.row);
      if (!fl || fl.state === 'sunk') { die('water'); return; }
    }

    if (row.type === 'water' && !p.hopping) {
      if (!World.logUnder(p.x, p.row)) { die('water'); return; }
      // Carried past the bank: still on screen when it happens, so you see it.
      if (p.x < World.CFG.X_MIN - 1 || p.x > World.CFG.X_MAX + 1) { die('water'); return; }
    }
  }

  /* ── The black car ──────────────────────────────────────────────────
     The tide punishes hesitation from behind; the black car punishes it
     everywhere else. Stand around with a comfortable lead and a secret
     police sedan tears onto your row, brakes at your tile, and takes you
     in. It only drives on land — the rivers and the ice punish idling by
     themselves. */

  function updateVan(dt) {
    var v = g.van;
    var p = g.player;
    var gap = p.row - g.tide.row;

    if (v.state === 'idle') {
      var rt = World.row(Math.round(p.row));
      var onLand = rt && rt.type !== 'water' && rt.type !== 'ice';
      if (g.idleT > 4.2 && gap > 6 && !p.dead && onLand) {
        v.state = 'warn';
        v.t = 0;
        v.x = Math.round(p.x);
        v.row = Math.round(p.row);
        v.fromSide = p.x >= 0 ? 1 : -1;   // enters from the nearer edge
        v.caught = false;
        PP.Audio.screech();
      }
    } else if (v.state === 'warn') {
      v.t += dt;
      if (v.t > 0.9) { v.state = 'arrive'; v.t = 0; PP.Audio.engine(); }
    } else if (v.state === 'arrive') {
      v.t += dt;
      if (v.t >= 0.45) {
        v.caught = !p.dead && Math.abs(p.x - v.x) < 0.6 && Math.abs(p.row - v.row) < 0.6;
        if (v.caught) die('van');
        else {
          g.idleT = 0;
          g.runStats.dodged = true;
          save.dodges++;
          persist();
          floater('DODGED', p.x, p.row + 0.6, '#8ee36a');
          checkDirectives();
        }
        v.state = 'grab';
        v.t = 0;
      }
    } else if (v.state === 'grab') {
      v.t += dt;
      if (v.t > (v.caught ? 0.7 : 0.35)) { v.state = 'depart'; v.t = 0; }
    } else if (v.state === 'depart') {
      v.t += dt;
      if (v.t > 1.0) v.state = 'idle';
    }
  }

  /* ── Traffic feedback: whooshes and honks, no gameplay effect ───── */

  function updateTraffic(dt) {
    var p = g.player;
    if (p.dead) return;
    var row = World.row(Math.round(p.row));
    if (!row || row.type !== 'road') return;
    for (var i = 0; i < row.cars.length; i++) {
      var car = row.cars[i];
      var cx = World.carX(row, car);
      var dxx = Math.abs(cx - p.x);
      var shave = car.w / 2 + HALF_W + 0.5;
      if (car._pd !== undefined && dxx < shave && car._pd >= shave && !p.hopping) {
        PP.Audio.whoosh();
        g.shake = Math.max(g.shake, 0.12);
      }
      car._pd = dxx;

      // An impatient beep from anyone bearing down on your column.
      var closing = row.dir > 0 ? p.x - cx : cx - p.x;
      if (closing > 0.8 && closing < 3.2 &&
          World.time() - (row.lastBeep || -9) > 1.6 && Math.random() < dt * 2.0) {
        row.lastBeep = World.time();
        PP.Audio.beep();
      }
    }
  }

  /* ── The Collective ─────────────────────────────────────────────── */

  function updateTide(dt) {
    var d = World.difficulty(g.score);
    var speed = 1.05 + d * 0.95;

    var gap = g.player.row - g.tide.row;
    // It closes fast when you get too far ahead — no safe lead, and the front
    // line stays near the bottom of the screen where you can see it coming.
    if (gap > 8) speed *= 1 + (gap - 8) * 0.35;
    // And it surges if you stand around thinking about it.
    if (g.idleT > IDLE_GRACE) speed *= 1 + Math.min(g.idleT - IDLE_GRACE, 4) * 0.55;

    g.tide.speed = speed;
    g.tide.row += speed * dt;

    // The band plays faster the closer it gets.
    PP.Music.setUrgent(gap < 5.5);
  }

  /* ── Camera ─────────────────────────────────────────────────────── */

  function updateCamera(dt) {
    if (g.mode === 'menu') {
      g.cam.row += 1.5 * dt;
      g.cam.x = U.approach(g.cam.x, Math.sin(World.time() * 0.25) * 2.2, 2, dt);
      g.tide.row = g.cam.row - 7.5;
      return;
    }
    var p = g.player;
    g.cam.row = U.approach(g.cam.row, p.row + 0.6, 7, dt);
    g.cam.x = U.approach(g.cam.x, U.clamp(p.x, -3.2, 3.2), 8, dt);
  }

  /* ── Run control ────────────────────────────────────────────────── */

  var Game = {
    g: g,
    save: save,

    setChar: function (id) {
      save.char = id;
      g.char = PP.Characters.byId(id);
      persist();
    },

    owns: function (id) { return save.owned.indexOf(id) !== -1; },

    buy: function (id) {
      var c = PP.Characters.byId(id);
      if (c.secret) { PP.Audio.deny(); return 'secret'; }
      if (Game.owns(id)) return 'owned';
      if (save.coins < c.price) { PP.Audio.deny(); return 'poor'; }
      save.coins -= c.price;
      save.owned.push(id);
      persist();
      PP.Audio.unlockChime();
      return 'bought';
    },

    enterMenu: function () {
      World.reset();
      g.mode = 'menu';
      g.cam = { x: 0, row: 4 };
      g.tide.row = -5;
      g.player = newPlayer();
      g.showPlayer = false;
      g.playerChar = null;
      g.particles.length = 0;
      g.floaters.length = 0;
      g.splashes.length = 0;
      g.shake = 0;
      g.flash = 0;
      g.van.state = 'idle';
      PP.Music.stop();
    },

    start: function () {
      World.reset();
      g.mode = 'playing';
      g.player = newPlayer();
      g.showPlayer = true;
      g.cam = { x: 0, row: 2.6 };
      g.tide.row = -7;
      g.tide.speed = 1.05;
      g.score = 0;
      g.runCoins = 0;
      g.idleT = 0;
      g.deathT = 0;
      g.nextMilestone = 25;
      g.bestLineRow = (save.best || 0) >= 3 ? save.best : -1;
      g.bestCrossed = false;
      g.van.state = 'idle';
      g.van.t = 0;
      g.runStats = { waterX: 0, iceX: 0, paradeX: 0, kibble: 0, dodged: false };
      g.streak = 0;
      g.lastFwdT = -9;
      g.slowmoT = 0;
      refreshDirectives();
      g.queued = null;
      g.particles.length = 0;
      g.floaters.length = 0;
      g.splashes.length = 0;
      g.playerChar = null;
      g.shake = 0;
      g.flash = 0;
      g.char = PP.Characters.byId(save.char);
      save.runs = (save.runs || 0) + 1;
      persist();
      PP.Music.setUrgent(false);
      PP.Music.start();
    },

    pause: function () {
      if (g.mode === 'playing') { g.mode = 'paused'; PP.Music.stop(); return true; }
      return false;
    },

    resume: function () {
      if (g.mode === 'paused') { g.mode = 'playing'; PP.Music.start(); }
    },

    isPlaying: function () { return g.mode === 'playing'; },
    mode: function () { return g.mode; },

    move: tryMove,

    /* Press-and-hold: the animal crouches, the hop fires on release. */
    charge: function () {
      if (g.mode === 'playing' && g.player && !g.player.dead && !g.player.hopping) {
        g.player.charging = true;
      }
    },
    uncharge: function () { if (g.player) g.player.charging = false; },

    /* The People's Lottery: 100 kibble, one guaranteed new comrade. */
    LOTTERY_COST: 100,
    lockedCount: function () {
      return PP.Characters.ROSTER.filter(function (c) {
        return !c.secret && save.owned.indexOf(c.id) === -1;
      }).length;
    },
    lottery: function () {
      // The State does not raffle off dissidents.
      var locked = PP.Characters.ROSTER.filter(function (c) {
        return !c.secret && save.owned.indexOf(c.id) === -1;
      });
      if (!locked.length || (save.coins || 0) < Game.LOTTERY_COST) {
        PP.Audio.deny();
        return null;
      }
      save.coins -= Game.LOTTERY_COST;
      var win = locked[U.randInt(0, locked.length - 1)];
      save.owned.push(win.id);
      save.char = win.id;
      g.char = PP.Characters.byId(win.id);
      persist();
      return win;
    },

    /* Distance bonus is paid out at the end of the run. */
    finishRun: function () {
      var bonus = Math.floor(g.score / 5);
      var earned = g.runCoins + bonus;
      var newBest = g.score > (save.best || 0);
      if (newBest) save.best = g.score;
      save.coins = (save.coins || 0) + earned;
      // Three clean escapes from the black car earn you the dissident.
      var unlockedSecret = false;
      if (save.dodges >= 3 && save.owned.indexOf('kotleta') === -1) {
        save.owned.push('kotleta');
        unlockedSecret = true;
      }
      persist();
      return {
        score: g.score, best: save.best, earned: earned, newBest: newBest,
        kind: g.player.deathKind, unlockedSecret: unlockedSecret
      };
    },

    /* For the title screen: the three active directives, displayable. */
    directiveList: function () {
      ensureDirectives();
      return save.directives.map(function (d) {
        var tpl = templateById(d.id) || { label: d.id, reward: 0, type: '' };
        var progText = '';
        if (tpl.type === 'hops') progText = Math.min(save.hops, tpl.target) + '/' + tpl.target;
        return { label: tpl.label, reward: tpl.reward, done: d.done, progText: progText };
      });
    },
    dodgeCount: function () { return save.dodges; },

    playerScreenPos: function () {
      return {
        x: PP.Render.sx(g.player ? g.player.x : 0, g.cam),
        y: PP.Render.sy(g.player ? g.player.row : g.cam.row, g.cam)
      };
    },

    update: function (dt) {
      if (g.mode === 'paused') return;
      if (g.slowmoT > 0) {
        g.slowmoT -= dt;
        dt *= 0.3;
      }

      if (g.mode === 'playing' || g.mode === 'dying' || g.mode === 'dead') {
        World.update(dt, g.player.row);
        if (g.mode === 'playing') {
          g.idleT += dt;
          updatePlayer(dt);
          updateTide(dt);
          updateVan(dt);
          updateTraffic(dt);
        } else {
          // The tide keeps rolling over the scene while the card comes up.
          g.tide.row += g.tide.speed * 0.7 * dt;
          updatePlayer(dt);
          if (g.mode === 'dying') {
            g.deathT += dt;
            var hold = g.player.deathKind === 'caught' ? CAUGHT_HOLD : DEATH_HOLD;
            if (g.deathT >= hold) {
              g.mode = 'dead';
              if (g.onDeath) g.onDeath(Game.finishRun());
            }
          }
        }
      } else {
        World.update(dt, g.cam.row);
      }

      updateCamera(dt);
      updateEffects(dt);
    }
  };

  PP.Game = Game;
})(window);
