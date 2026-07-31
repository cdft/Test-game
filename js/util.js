/* Small helpers shared by every module. Everything hangs off window.PP
   so the game runs straight off the filesystem (no modules, no server). */
(function (global) {
  'use strict';

  var PP = global.PP || (global.PP = {});

  var U = {
    clamp: function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; },

    lerp: function (a, b, t) { return a + (b - a) * t; },

    /* Frame-rate independent easing toward a target. */
    approach: function (a, b, rate, dt) {
      return b + (a - b) * Math.exp(-rate * dt);
    },

    rand: function (lo, hi) { return lo + Math.random() * (hi - lo); },

    randInt: function (lo, hi) { return Math.floor(lo + Math.random() * (hi - lo + 1)); },

    pick: function (arr) { return arr[Math.floor(Math.random() * arr.length)]; },

    /* Weighted pick. `table` is [[value, weight], ...]. */
    weighted: function (table) {
      var total = 0, i;
      for (i = 0; i < table.length; i++) total += table[i][1];
      var r = Math.random() * total;
      for (i = 0; i < table.length; i++) {
        r -= table[i][1];
        if (r <= 0) return table[i][0];
      }
      return table[table.length - 1][0];
    },

    /* Positive modulo — JS's % keeps the sign of the dividend. */
    mod: function (a, n) { return ((a % n) + n) % n; },

    roundRect: function (ctx, x, y, w, h, r) {
      r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    },

    ellipse: function (ctx, x, y, rx, ry) {
      ctx.beginPath();
      ctx.ellipse(x, y, Math.max(rx, 0.01), Math.max(ry, 0.01), 0, 0, Math.PI * 2);
    },

    /* #rrggbb -> lighter/darker by amt in [-1, 1]. */
    shade: function (hex, amt) {
      var n = parseInt(hex.slice(1), 16);
      var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      var t = amt < 0 ? 0 : 255;
      var p = Math.abs(amt);
      r = Math.round((t - r) * p + r);
      g = Math.round((t - g) * p + g);
      b = Math.round((t - b) * p + b);
      return 'rgb(' + r + ',' + g + ',' + b + ')';
    },

    /* localStorage that never throws (private mode, file:// quirks, ...). */
    store: {
      get: function (key, fallback) {
        try {
          var raw = global.localStorage.getItem(key);
          return raw === null ? fallback : JSON.parse(raw);
        } catch (e) { return fallback; }
      },
      set: function (key, value) {
        try { global.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
      }
    },

    $: function (id) { return document.getElementById(id); },

    on: function (el, type, fn, opts) { if (el) el.addEventListener(type, fn, opts || false); }
  };

  PP.U = U;
})(window);
