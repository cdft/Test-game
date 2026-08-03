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

  function persist() { U.store.set(SAVE_KEY, save); }

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
        g.splashes.push({ x: p.x, row: p.row, t: 0, maxT: 0.5, kind: 'ripple' });
      }
    } else if (row) {
      // A little kick of dust marks every landing on solid ground.
      g.splashes.push({ x: p.x, row: p.row, t: 0, maxT: 0.38, kind: 'dust' });
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
      PP.Music.fadeOut(0.5);
    } else if (kind === 'water') {
      splash(p.x, p.row);
      g.shake = 0.35;
      PP.Audio.splash();
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
