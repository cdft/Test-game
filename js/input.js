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

  function init(canvas, handlers) {
    // Every finger is tracked on its own, so a thumb resting on the glass
    // never turns another thumb's tap into a phantom swipe.
    var pointers = {};

    function move(dir) {
      PP.Audio.unlock();
      handlers.onMove(dir);
    }

    function held() {
      for (var k in pointers) if (Object.prototype.hasOwnProperty.call(pointers, k)) return true;
      return false;
    }

    U.on(global, 'keydown', function (e) {
      var dir = KEY_DIR[e.code];
      if (dir) {
        // A held arrow keeps hopping; that is a feature.
        e.preventDefault();
        move(dir);
        return;
      }
      var confirmKey = e.code === 'Space' || e.code === 'Enter';
      // A focused menu button gets its own click (not the HUD icons, which
      // stay on screen mid-run). A held key must not click it again.
      if (confirmKey && e.target && e.target.tagName === 'BUTTON' && !e.target.closest('#hud')) {
        if (e.repeat) e.preventDefault();
        return;
      }
      // Everything else fires once per press, not on every auto-repeat.
      if (e.repeat) { if (confirmKey) e.preventDefault(); return; }
      if (confirmKey) {
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
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function down(e) {
      var p = pos(e);
      pointers[e.pointerId] = { x: p.x, y: p.y, moved: false };
      PP.Audio.unlock();
      // Press-and-hold: the animal crouches until you release.
      if (handlers.onCharge) handlers.onCharge();
    }

    function drag(e) {
      var s = pointers[e.pointerId];
      if (!s || s.moved) return;
      var p = pos(e);
      var dx = p.x - s.x;
      var dy = p.y - s.y;
      if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) return;
      s.moved = true;
      if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 'right' : 'left');
      else move(dy > 0 ? 'down' : 'up');
    }

    function up(e) {
      var s = pointers[e.pointerId];
      if (!s) return;
      delete pointers[e.pointerId];
      // A tap anywhere is a hop forward. Sideways and back are swipes, so a
      // thumb resting low on the screen never walks you into the tide.
      if (!s.moved) move('up');
      else if (!held() && handlers.onChargeCancel) handlers.onChargeCancel();
    }

    U.on(canvas, 'pointerdown', down);
    U.on(canvas, 'pointermove', drag);
    U.on(canvas, 'pointerup', up);
    U.on(canvas, 'pointercancel', function (e) {
      delete pointers[e.pointerId];
      if (!held() && handlers.onChargeCancel) handlers.onChargeCancel();
    });
    U.on(canvas, 'contextmenu', function (e) { e.preventDefault(); });
    U.on(canvas, 'touchstart', function (e) { e.preventDefault(); }, { passive: false });
  }

  PP.Input = { init: init };
})(window);
