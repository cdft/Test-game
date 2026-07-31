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

  var SAVE_KEY = 'pp.save';

  var save = U.store.get(SAVE_KEY, null) || {
    best: 0, coins: 0, runs: 0, owned: ['mittens', 'biscuit'], char: 'mittens'
  };
  if (!save.owned || !save.owned.length) save.owned = ['mittens', 'biscuit'];

  function persist() { U.store.set(SAVE_KEY, save); }

  var g = {
    mode: 'menu',              // menu | playing | paused | dying | dead
    cam: { x: 0, row: 2 },
    player: null,
    tide: { row: -7, speed: 1.2 },
    particles: [],
    floaters: [],
    shake: 0,
    flash: 0,
    showPlayer: false,
    char: PP.Characters.byId(save.char),
    score: 0,
    runCoins: 0,
    idleT: 0,
    deathT: 0,
    nextMilestone: 25,
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
      onLog: null,
      dead: false, deathKind: null, sinkT: 0,
      bumpT: 0
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
    g.shake = Math.max(0, g.shake - dt * 2.2);
    g.flash = Math.max(0, g.flash - dt * 3.0);
  }

  /* ── Movement ───────────────────────────────────────────────────── */

  function tryMove(dir) {
    if (g.mode !== 'playing') return;
    var p = g.player;
    if (p.dead) return;

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
    if (dir === 'up') g.idleT = 0;
    PP.Audio.hop();
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
      }
    }

    var coin = World.coinAt(Math.round(p.x), p.row);
    if (coin) {
      coin.taken = true;
      g.runCoins += COIN_VALUE;
      floater('+' + COIN_VALUE, p.x, p.row, '#f5c542');
      puff(p.x, p.row, '#f5c542', 8, 1.6);
      PP.Audio.coin();
    }

    if (p.row > g.score) {
      g.score = p.row;
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

    if (kind === 'squash') {
      g.shake = 1;
      g.flash = 0.5;
      puff(p.x, p.row, g.char.fur, 16, 3.2);
      PP.Audio.squash();
    } else if (kind === 'water') {
      puff(p.x, p.row, 'rgba(200,235,255,0.95)', 14, 2.2);
      PP.Audio.splash();
    } else {
      g.shake = 0.7;
      puff(p.x, p.row, '#c8102e', 18, 2.6);
      PP.Audio.caught();
    }
  }

  function checkDeath() {
    var p = g.player;
    var row = World.row(p.row);
    if (!row) return;

    if (g.tide.row >= p.row - 0.05) { die('caught'); return; }

    if (row.type === 'road' && World.carAt(p.x, p.row, HALF_W)) { die('squash'); return; }
    if (row.type === 'rail' && World.trainAt(p.x, p.row, HALF_W)) { die('squash'); return; }

    if (row.type === 'water' && !p.hopping) {
      if (!World.logUnder(p.x, p.row)) { die('water'); return; }
      // Carried past the bank: still on screen when it happens, so you see it.
      if (p.x < World.CFG.X_MIN - 1 || p.x > World.CFG.X_MAX + 1) { die('water'); return; }
    }
  }

  /* ── The Collective ─────────────────────────────────────────────── */

  function updateTide(dt) {
    var d = World.difficulty(g.score);
    var speed = 1.05 + d * 1.25;

    var gap = g.player.row - g.tide.row;
    // It closes fast when you get too far ahead — no safe lead, and the front
    // line stays near the bottom of the screen where you can see it coming.
    if (gap > 8) speed *= 1 + (gap - 8) * 0.35;
    // And it surges if you stand around thinking about it.
    if (g.idleT > IDLE_GRACE) speed *= 1 + Math.min(g.idleT - IDLE_GRACE, 4) * 0.55;

    g.tide.speed = speed;
    g.tide.row += speed * dt;
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
      g.particles.length = 0;
      g.floaters.length = 0;
      g.shake = 0;
      g.flash = 0;
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
      g.queued = null;
      g.particles.length = 0;
      g.floaters.length = 0;
      g.shake = 0;
      g.flash = 0;
      g.char = PP.Characters.byId(save.char);
      save.runs = (save.runs || 0) + 1;
      persist();
    },

    pause: function () {
      if (g.mode === 'playing') { g.mode = 'paused'; return true; }
      return false;
    },

    resume: function () {
      if (g.mode === 'paused') g.mode = 'playing';
    },

    isPlaying: function () { return g.mode === 'playing'; },
    mode: function () { return g.mode; },

    move: tryMove,

    /* Distance bonus is paid out at the end of the run. */
    finishRun: function () {
      var bonus = Math.floor(g.score / 5);
      var earned = g.runCoins + bonus;
      var newBest = g.score > (save.best || 0);
      if (newBest) save.best = g.score;
      save.coins = (save.coins || 0) + earned;
      persist();
      return { score: g.score, best: save.best, earned: earned, newBest: newBest, kind: g.player.deathKind };
    },

    playerScreenPos: function () {
      return {
        x: PP.Render.sx(g.player ? g.player.x : 0, g.cam),
        y: PP.Render.sy(g.player ? g.player.row : g.cam.row, g.cam)
      };
    },

    update: function (dt) {
      if (g.mode === 'paused') return;

      if (g.mode === 'playing' || g.mode === 'dying' || g.mode === 'dead') {
        World.update(dt, g.player.row);
        if (g.mode === 'playing') {
          g.idleT += dt;
          updatePlayer(dt);
          updateTide(dt);
        } else {
          // The tide keeps rolling over the scene while the card comes up.
          g.tide.row += g.tide.speed * 0.7 * dt;
          updatePlayer(dt);
          if (g.mode === 'dying') {
            g.deathT += dt;
            if (g.deathT >= DEATH_HOLD) {
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
