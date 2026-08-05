/* Keyboard, swipe and tap. Everything funnels into two callbacks:
   onMove(dir) and onAction(name). */
(function (global) {
  'use strict';

  var PP = global.PP;
  var U = PP.U;

  var KEY_DIR = {
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right'
  };

  var SWIPE_MIN = 26;      // px before a drag counts as a swipe
  var TAP_DEAD = 34;       // px around the player that means "forward"

  function init(canvas, handlers) {
    var start = null;
    var moved = false;

    function move(dir) {
      PP.Audio.unlock();
      handlers.onMove(dir);
    }

    U.on(global, 'keydown', function (e) {
      var dir = KEY_DIR[e.code];
      if (dir) {
        e.preventDefault();
        move(dir);
        return;
      }
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        PP.Audio.unlock();
        handlers.onAction('primary');
      } else if (e.code === 'KeyP' || e.code === 'Escape') {
        handlers.onAction('pause');
      } else if (e.code === 'KeyM') {
        handlers.onAction('mute');
      } else if (e.code === 'KeyR') {
        handlers.onAction('restart');
      }
    });

    function pos(e) {
      var rect = canvas.getBoundingClientRect();
      var src = e.touches && e.touches.length ? e.touches[0]
        : (e.changedTouches && e.changedTouches.length ? e.changedTouches[0] : e);
      return { x: src.clientX - rect.left, y: src.clientY - rect.top };
    }

    function down(e) {
      start = pos(e);
      moved = false;
      PP.Audio.unlock();
      // Press-and-hold: the animal crouches until you release.
      if (handlers.onCharge) handlers.onCharge();
    }

    function drag(e) {
      if (!start || moved) return;
      var p = pos(e);
      var dx = p.x - start.x;
      var dy = p.y - start.y;
      if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) return;
      moved = true;
      if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 'right' : 'left');
      else move(dy > 0 ? 'down' : 'up');
    }

    function up(e) {
      if (!start) return;
      if (!moved) {
        // A tap: read the direction from where it landed relative to the player.
        var p = pos(e);
        var anchor = handlers.playerScreenPos();
        var dx = p.x - anchor.x;
        var dy = p.y - anchor.y;
        if (Math.abs(dx) < TAP_DEAD && Math.abs(dy) < TAP_DEAD) move('up');
        else if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 'right' : 'left');
        else move(dy > 0 ? 'down' : 'up');
      }
      start = null;
      moved = false;
    }

    U.on(canvas, 'pointerdown', down);
    U.on(canvas, 'pointermove', drag);
    U.on(canvas, 'pointerup', up);
    U.on(canvas, 'pointercancel', function () {
      start = null;
      if (handlers.onChargeCancel) handlers.onChargeCancel();
    });
    U.on(canvas, 'contextmenu', function (e) { e.preventDefault(); });
    U.on(canvas, 'touchstart', function (e) { e.preventDefault(); }, { passive: false });
  }

  PP.Input = { init: init };
})(window);
