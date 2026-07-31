/* Boot, DOM wiring and the frame loop. */
(function (global) {
  'use strict';

  var PP = global.PP;
  var U = PP.U;
  var Game = PP.Game;

  var canvas = U.$('stage');
  var hud = U.$('hud');
  var elScore = U.$('score');
  var elCoins = U.$('coins');
  var elWarning = U.$('warning');

  var SCREENS = ['screen-title', 'screen-pick', 'screen-help', 'screen-pause', 'screen-over'];

  var DEATHS = {
    squash: {
      title: 'FLATTENED',
      flavor: 'Requisitioned vehicles do not yield. It is not personal, it is procedural.'
    },
    water: {
      title: 'NATIONALISED',
      flavor: 'The canal has accepted your resignation, effective immediately.'
    },
    caught: {
      title: 'REDISTRIBUTED',
      flavor: 'Your snacks, your cushion and your name now belong to everyone.'
    }
  };

  function showScreen(id) {
    SCREENS.forEach(function (s) {
      var el = U.$(s);
      if (el) el.classList.toggle('hidden', s !== id);
    });
    hud.classList.toggle('hidden', id !== null && id !== 'screen-pause');
  }

  function hideScreens() { showScreen(null); }

  /* ── Title stats ────────────────────────────────────────────────── */

  function refreshStats() {
    U.$('t-best').textContent = Game.save.best || 0;
    U.$('t-coins').textContent = Game.save.coins || 0;
    U.$('t-runs').textContent = Game.save.runs || 0;
    U.$('p-coins').textContent = Game.save.coins || 0;
  }

  /* ── Character select ───────────────────────────────────────────── */

  function buildRoster() {
    var host = U.$('roster');
    host.innerHTML = '';
    PP.Characters.ROSTER.forEach(function (c) {
      var owned = Game.owns(c.id);
      var card = document.createElement('div');
      card.className = 'card' + (Game.save.char === c.id ? ' selected' : '') + (owned ? '' : ' locked');

      var cnv = document.createElement('canvas');
      card.appendChild(cnv);

      var name = document.createElement('div');
      name.className = 'name';
      name.textContent = c.name;
      card.appendChild(name);

      var tag = document.createElement('div');
      tag.className = 'tag';
      tag.textContent = c.tag;
      card.appendChild(tag);

      var foot = document.createElement('div');
      if (owned) {
        foot.className = 'owned';
        foot.textContent = Game.save.char === c.id ? 'SELECTED' : 'ready';
      } else {
        foot.className = 'price' + ((Game.save.coins || 0) >= c.price ? '' : ' cant');
        foot.textContent = '🍖 ' + c.price;
      }
      card.appendChild(foot);

      card.addEventListener('click', function () {
        PP.Audio.unlock();
        if (!Game.owns(c.id)) {
          var res = Game.buy(c.id);
          if (res !== 'bought') { refreshStats(); buildRoster(); return; }
        } else {
          PP.Audio.blip();
        }
        Game.setChar(c.id);
        refreshStats();
        buildRoster();
      });

      host.appendChild(card);
      PP.Render.drawPortrait(cnv, c);
    });
  }

  /* ── Flow ───────────────────────────────────────────────────────── */

  function toMenu() {
    Game.enterMenu();
    refreshStats();
    showScreen('screen-title');
  }

  function startRun() {
    Game.start();
    elScore.textContent = '0';
    elCoins.textContent = '0';
    hideScreens();
  }

  function onDeath(result) {
    var info = DEATHS[result.kind] || DEATHS.caught;
    U.$('over-title').textContent = info.title;
    U.$('over-flavor').textContent = info.flavor;
    U.$('o-score').textContent = result.score;
    U.$('o-best').textContent = result.best;
    U.$('o-coins').textContent = result.earned;
    U.$('o-newbest').classList.toggle('hidden', !result.newBest);
    refreshStats();
    showScreen('screen-over');
  }

  Game.g.onDeath = onDeath;

  function togglePause() {
    if (Game.pause()) showScreen('screen-pause');
    else if (Game.mode() === 'paused') { Game.resume(); hideScreens(); }
  }

  function toggleMute() {
    var muted = PP.Audio.toggleMute();
    U.$('btn-mute').textContent = muted ? '🔇' : '🔊';
  }

  /* ── Buttons ────────────────────────────────────────────────────── */

  U.on(U.$('btn-play'), 'click', function () { PP.Audio.unlock(); startRun(); });
  U.on(U.$('btn-again'), 'click', startRun);
  U.on(U.$('btn-menu'), 'click', toMenu);
  U.on(U.$('btn-resume'), 'click', function () { Game.resume(); hideScreens(); });
  U.on(U.$('btn-quit'), 'click', toMenu);
  U.on(U.$('btn-pause'), 'click', togglePause);
  U.on(U.$('btn-mute'), 'click', toggleMute);
  U.on(U.$('btn-help'), 'click', function () { showScreen('screen-help'); });
  U.on(U.$('btn-help-back'), 'click', function () { showScreen('screen-title'); });
  U.on(U.$('btn-pick-back'), 'click', function () { showScreen('screen-title'); });

  function openPicker() {
    refreshStats();
    buildRoster();
    showScreen('screen-pick');
  }
  U.on(U.$('btn-pick'), 'click', openPicker);
  U.on(U.$('btn-over-pick'), 'click', openPicker);

  /* ── Input ──────────────────────────────────────────────────────── */

  PP.Input.init(canvas, {
    onMove: function (dir) {
      if (Game.isPlaying()) Game.move(dir);
      else if (Game.mode() === 'menu' && dir === 'up') startRun();
    },
    onAction: function (name) {
      var mode = Game.mode();
      if (name === 'mute') { toggleMute(); return; }
      if (name === 'pause') {
        if (mode === 'playing' || mode === 'paused') togglePause();
        return;
      }
      if (name === 'restart') {
        if (mode === 'dead' || mode === 'playing' || mode === 'paused') startRun();
        return;
      }
      if (name === 'primary') {
        if (mode === 'menu') startRun();
        else if (mode === 'dead') startRun();
        else if (mode === 'paused') { Game.resume(); hideScreens(); }
      }
    },
    playerScreenPos: Game.playerScreenPos
  });

  /* ── Loop ───────────────────────────────────────────────────────── */

  PP.Render.init(canvas);
  U.on(global, 'resize', function () { PP.Render.resize(); });
  U.on(global, 'orientationchange', function () { setTimeout(PP.Render.resize, 120); });
  U.on(document, 'visibilitychange', function () {
    if (document.hidden && Game.pause()) showScreen('screen-pause');
  });

  var last = 0;

  function frame(now) {
    global.requestAnimationFrame(frame);
    if (!last) last = now;
    // Clamp dt so a background tab or a slow frame can't teleport anyone.
    var dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    Game.update(dt);

    if (Game.mode() === 'playing' || Game.mode() === 'dying') {
      elScore.textContent = Game.g.score;
      elCoins.textContent = Game.g.runCoins;
      var gap = Game.g.player.row - Game.g.tide.row;
      elWarning.classList.toggle('hidden', !(gap < 4.5 && Game.mode() === 'playing'));
    }

    PP.Render.draw(Game.g);
  }

  U.$('btn-mute').textContent = PP.Audio.isMuted() ? '🔇' : '🔊';
  toMenu();
  global.requestAnimationFrame(frame);
})(window);
