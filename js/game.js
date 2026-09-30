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

  var save = U.store.get(SAVE_KEY, null);
  if (!save || typeof save !== 'object' || Array.isArray(save)) {
    save = { best: 0, coins: 0, runs: 0, owned: ['mittens', 'biscuit'], char: 'mittens', v: 2 };
  }
  if (!save.owned || !save.owned.length) save.owned = ['mittens', 'biscuit'];
  save.dodges = save.dodges || 0;
  save.hops = save.hops || 0;
  // v2: distance is measured from where you start (row 2), not from row 0.
  if ((save.v || 1) < 2) {
    save.best = Math.max(0, (save.best || 0) - World.CFG.START_ROW);
    save.v = 2;
  }

  function persist() { U.store.set(SAVE_KEY, save); }

  /* ── The Daily Escape ───────────────────────────────────────────────
     One world per calendar day, the same for everyone: a date is hashed
     into the world seed. Compare runs with friends on equal terms. */
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function dailySeed(day) {
    var h = 2166136261;   // FNV-1a
    var key = 'paws-daily-' + day;
    for (var i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
  }

  function dailyBest() {
    return save.daily && save.daily.day === today() ? save.daily.best : 0;
  }

  /* Kibble is banked the moment it is earned, so quitting, restarting or
     closing the tab never loses it. */
  function earn(amount) {
    g.runCoins += amount;
    save.coins = (save.coins || 0) + amount;
    persist();
  }

  /* ── State Directives ─────────────────────────────────────────────
     Three rotating objectives. Complete one mid-run and the bounty is
     paid on the spot; a fresh directive replaces it next run. */

  var D_TEMPLATES = [
    { id: 'dist30', label: 'Reach 30m in one run', short: '30m REACHED', type: 'dist', target: 30, reward: 40 },
    { id: 'dist50', label: 'Reach 50m in one run', short: '50m REACHED', type: 'dist', target: 50, reward: 60 },
    { id: 'dist80', label: 'Reach 80m in one run', short: '80m REACHED', type: 'dist', target: 80, reward: 90 },
    { id: 'coins15', label: 'Pick up 15 kibble off the street in one run', short: 'SCAVENGER', type: 'coins', target: 15, reward: 40 },
    { id: 'rivers4', label: 'Cross 4 canals in one run', short: '4 CANALS', type: 'rivers', target: 4, reward: 40 },
    { id: 'ice3', label: 'Cross 3 frozen rows in one run', short: 'THIN ICE WALKER', type: 'ice', target: 3, reward: 50 },
    { id: 'parade2', label: 'Slip past 2 parades in one run', short: 'PARADE DODGER', type: 'parade', target: 2, reward: 50 },
    { id: 'dodge1', label: 'Dodge the black car', short: 'CAR DODGED', type: 'dodge', target: 1, reward: 60 },
    { id: 'hops500', label: 'Hop 500 times, in total', short: '500 HOPS', type: 'hops', target: 500, reward: 50 },
    { id: 'record', label: 'Break your record', short: 'RECORD BROKEN', type: 'record', target: 1, reward: 50 }
  ];

  function templateById(id) {
    for (var i = 0; i < D_TEMPLATES.length; i++) if (D_TEMPLATES[i].id === id) return D_TEMPLATES[i];
    return null;
  }

  function pickDirective(exceptIds) {
    var pool = D_TEMPLATES.filter(function (tpl) {
      // Nobody can break a record they have not set yet.
      if (tpl.type === 'record' && (save.best || 0) < 3) return false;
      return exceptIds.indexOf(tpl.id) === -1;
    });
    return pool[U.randInt(0, pool.length - 1)];
  }

  /* A directive remembers where its counter stood when it was issued, so
     "hop 500 times" means 500 more hops, not 500 in your whole life. */
  function issue(tpl) {
    var d = { id: tpl.id, done: false };
    if (tpl.type === 'hops') d.base = save.hops;
    return d;
  }

  function ensureDirectives() {
    var valid = (save.directives || []).filter(function (d) {
      if (!d || !templateById(d.id)) return false;
      // An old save may hold a record directive nobody can meet yet.
      return !(d.id === 'record' && !d.done && (save.best || 0) < 3);
    });
    if (valid.length !== 3) {
      save.directives = valid.slice(0, 3);
      while (save.directives.length < 3) {
        var have = save.directives.map(function (d) { return d.id; });
        save.directives.push(issue(pickDirective(have)));
      }
    }
    // Saves from before baselines existed: start counting from now.
    save.directives.forEach(function (d) {
      if (d.id === 'hops500' && d.base === undefined) d.base = save.hops;
    });
    persist();
  }

  function refreshDirectives() {
    ensureDirectives();
    var changed = false;
    for (var i = 0; i < save.directives.length; i++) {
      if (save.directives[i].done) {
        var have = save.directives.map(function (d) { return d.id; });
        save.directives[i] = issue(pickDirective(have));
        changed = true;
      }
    }
    if (changed) persist();
  }

  function directiveValue(tpl, d) {
    switch (tpl.type) {
      case 'dist': return g.score;
      case 'coins': return g.runStats.kibble;
      case 'rivers': return g.runStats.waterX;
      case 'ice': return g.runStats.iceX;
      case 'parade': return g.runStats.paradeX;
      case 'dodge': return g.runStats.dodged ? 1 : 0;
      case 'hops': return save.hops - (d.base || 0);
      case 'record': return g.startBest >= 3 && g.score > g.startBest ? 1 : 0;
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
      if (directiveValue(tpl, d) >= tpl.target) {
        d.done = true;
        // Paid on the spot, into the bank, not just onto the run's tally.
        earn(tpl.reward);
        floater((tpl.short || 'DIRECTIVE') + ' +' + tpl.reward, g.player.x, g.player.row + 1.0, '#8ee36a');
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
    score: 0,                  // metres: furthest row reached, from the start line
    maxRow: 0,
    started: false,            // the chase waits for your first hop
    daily: null,               // the day's date on a Daily Escape run
    banked: false,             // this run's distance bonus and best are saved
    bonusBanked: 0,            // distance bonus already paid out mid-run
    startBest: 0,
    unlockedSecret: false,
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
    // Rewards often land on the same hop; stack them instead of overprinting.
    for (var i = 0; i < g.floaters.length; i++) {
      var f = g.floaters[i];
      if (f.life > 0.35 && Math.abs(f.x - x) < 2.5 && Math.abs(f.row - row) < 0.7) row = f.row + 0.7;
    }
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

  /* Momentum: ten quick hops onto new ground, kept alive by the next one. */
  function hasMomentum() {
    return g.streak >= 10 && World.time() - g.lastFwdT < 0.9;
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

    // A log can carry you to the very edge; up and down hops leave from the
    // nearest real column. Sideways hops aim one column over, as always.
    var baseX = Math.round(p.x);
    if (dir === 'up' || dir === 'down') baseX = U.clamp(baseX, World.CFG.X_MIN, World.CFG.X_MAX);
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
    g.started = true;
    if (dir === 'up') {
      g.idleT = 0;
      // Momentum is built on new ground only; bouncing in place earns none.
      if (toRow > g.maxRow) {
        var nowT = World.time();
        g.streak = (nowT - g.lastFwdT < 0.9) ? g.streak + 1 : 1;
        g.lastFwdT = nowT;
      }
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
    if (!g.bestCrossed && g.bestLineRow >= 0 && p.row > g.bestLineRow) {
      g.bestCrossed = true;
      floater('RECORD BROKEN', p.x, p.row + 0.6, '#f5c542');
      puff(p.x, p.row, '#f5c542', 16, 2.6);
      PP.Audio.milestone();
      checkDirectives();
    }

    var coin = World.coinAt(Math.round(p.x), p.row);
    if (coin) {
      coin.taken = true;
      var mult = hasMomentum() ? 2 : 1;   // momentum pays double
      g.runStats.kibble += COIN_VALUE * mult;
      earn(COIN_VALUE * mult);
      floater('+' + (COIN_VALUE * mult), p.x, p.row, '#f5c542');
      puff(p.x, p.row, '#f5c542', 8, 1.6);
      PP.Audio.coin();
      checkDirectives();
    }

    if (p.row > g.maxRow) {
      g.maxRow = p.row;
      g.score = Math.max(0, g.maxRow - World.CFG.START_ROW);
      // The row now fully behind you counts as crossed.
      var behind = World.row(g.maxRow - 1);
      if (behind) {
        if (behind.type === 'water') g.runStats.waterX++;
        else if (behind.type === 'ice') g.runStats.iceX++;
        else if (behind.type === 'parade') g.runStats.paradeX++;
        else if (behind.type === 'checkpoint') {
          // Through the gate: the paperwork delays them.
          earn(25);
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

    // Where you landed decides whether you live, before any buffered hop
    // can carry you on (otherwise a quick tapper could walk on water).
    checkDeath();
    if (p.dead) { g.queued = null; return; }

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

  /* `kind` is how the death looks; `cause` picks the game-over card. */
  function die(kind, cause) {
    var p = g.player;
    if (p.dead) return;
    p.dead = true;
    p.deathKind = kind;
    p.deathCause = cause || kind;
    p.hopping = false;
    g.mode = 'dying';
    g.deathT = 0;
    // A beat of slow motion sells the impact; conversion is already slow.
    if (kind !== 'caught') g.slowmoT = 0.45;
    // And the phone in your hand feels it (where phones allow it).
    if (global.navigator && global.navigator.vibrate && !PP.Audio.isMuted()) {
      try { global.navigator.vibrate(kind === 'caught' ? [40, 60, 40] : 70); } catch (e) { /* not allowed */ }
    }

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
    if (g.tide.row >= p.row - 0.05) { die('caught'); return; }

    // Mid-hop between rows, traffic on the row you are landing in can reach
    // you once you are drawn over it; the row you are leaving cannot.
    var ri = p.row;
    if (ri !== Math.floor(ri)) {
      if (p.hopT / HOP_TIME < 0.5) return;
      ri = p.toRow;
    }
    var row = World.row(ri);
    if (!row) return;

    if (row.type === 'road' && World.carAt(p.x, ri, HALF_W)) { die('squash'); return; }
    if (row.type === 'parade' && World.carAt(p.x, ri, HALF_W)) { die('caught', 'parade'); return; }
    if (row.type === 'rail' && World.trainAt(p.x, ri, HALF_W)) { die('squash'); return; }

    if (p.hopping) return;

    if (row.type === 'ice') {
      var fl = World.floeAt(p.x, ri);
      if (!fl || fl.state === 'sunk') { die('water', 'ice'); return; }
    }

    if (row.type === 'water') {
      if (!World.logUnder(p.x, ri)) { die('water'); return; }
      // Carried past the bank: still on screen when it happens, so you see it.
      if (p.x < World.CFG.X_MIN - 1 || p.x > World.CFG.X_MAX + 1) { die('water', 'drift'); return; }
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
          // Three clean escapes from the black car earn you the dissident.
          if (save.dodges >= 3 && save.owned.indexOf('kotleta') === -1) {
            save.owned.push('kotleta');
            persist();
            g.unlockedSecret = true;
            floater('SECRET COMRADE', p.x, p.row + 1.0, '#f5c542');
            PP.Audio.unlockChime();
          }
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

    start: function (opts) {
      g.daily = opts && opts.daily ? today() : null;
      World.reset(g.daily ? dailySeed(g.daily) : undefined);
      g.mode = 'playing';
      g.player = newPlayer();
      g.showPlayer = true;
      g.cam = { x: 0, row: 2.6 };
      g.tide.row = -7;
      g.tide.speed = 1.05;
      g.score = 0;
      g.maxRow = g.player.row;
      g.started = false;
      g.banked = false;
      g.bonusBanked = 0;
      g.startBest = save.best || 0;
      g.unlockedSecret = false;
      g.runCoins = 0;
      g.idleT = 0;
      g.deathT = 0;
      g.nextMilestone = 25;
      g.bestLineRow = g.startBest >= 3 ? g.startBest + World.CFG.START_ROW : -1;
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
      if (g.mode === 'playing') {
        g.mode = 'paused';
        g.shake = 0;   // a frozen frame should not be a shaken one
        PP.Music.stop();
        return true;
      }
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

    /* Kibble is banked as it is earned; the distance bonus and your best
       are settled once, when the run ends — however it ends. */
    finishRun: function () {
      var bonus = Math.floor(g.score / 5);
      var newBest = g.score > g.startBest;
      var newDaily = false;
      if (!g.banked) {
        g.banked = true;
        if (g.score > (save.best || 0)) save.best = g.score;
        if (g.daily) {
          newDaily = g.score > dailyBest();
          if (newDaily || !save.daily || save.daily.day !== g.daily) {
            save.daily = { day: g.daily, best: Math.max(g.score, dailyBest()) };
          }
        }
        save.coins = (save.coins || 0) + bonus - g.bonusBanked;
        g.bonusBanked = bonus;
        // Older saves may have earned the dissident before it unlocked live.
        if (save.dodges >= 3 && save.owned.indexOf('kotleta') === -1) {
          save.owned.push('kotleta');
          g.unlockedSecret = true;
        }
        persist();
      }
      return {
        score: g.score, best: save.best, earned: g.runCoins + bonus, bonus: bonus, newBest: newBest,
        kind: g.player.deathCause || g.player.deathKind, unlockedSecret: g.unlockedSecret,
        daily: g.daily, dailyBest: g.daily ? dailyBest() : 0, newDaily: newDaily
      };
    },

    /* When the tab is hidden or closed mid-run, write down the record and
       the distance bonus so far; the phone may never let the page back. */
    saveProgress: function () {
      if (!g.player || g.banked || (g.mode !== 'playing' && g.mode !== 'paused' && g.mode !== 'dying')) return;
      if (g.score > (save.best || 0)) save.best = g.score;
      var bonus = Math.floor(g.score / 5);
      if (bonus > g.bonusBanked) {
        save.coins = (save.coins || 0) + bonus - g.bonusBanked;
        g.bonusBanked = bonus;
      }
      persist();
    },

    /* Leaving a run early (quit, restart) still banks it. */
    abandon: function () {
      if (g.player && !g.banked && (g.mode === 'playing' || g.mode === 'paused' || g.mode === 'dying')) {
        Game.finishRun();
      }
    },

    /* For the title screen: the three active directives, displayable. */
    directiveList: function () {
      ensureDirectives();
      return save.directives.map(function (d) {
        var tpl = templateById(d.id) || { label: d.id, reward: 0, type: '' };
        var progText = '';
        if (tpl.type === 'hops') progText = Math.min(save.hops - (d.base || 0), tpl.target) + '/' + tpl.target;
        return { label: tpl.label, reward: tpl.reward, done: d.done, progText: progText };
      });
    },
    dodgeCount: function () { return save.dodges; },
    today: today,
    dailySeed: dailySeed,
    dailyBest: dailyBest,

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
          // The Collective waits for you to make the first move.
          if (g.started) g.idleT += dt;
          if (g.streak && World.time() - g.lastFwdT >= 0.9) g.streak = 0;
          updatePlayer(dt);
          if (g.started) {
            updateTide(dt);
            updateVan(dt);
          }
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
