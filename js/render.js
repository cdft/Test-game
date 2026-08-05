/* All drawing. A faux-3D side-on view: the world is a stack of horizontal
   bands, near rows are lower on screen, everything is drawn far-to-near so
   tall scenery occludes correctly.

   The scene is lit by one low sun at the upper right. Everything follows
   that: long shadows fall to the lower left, sun-facing edges catch a warm
   highlight, water blushes near the horizon, and a full-screen dusk grade
   cools the foreground where the night (and the Collective) is coming from. */
(function (global) {
  'use strict';

  var PP = global.PP;
  var U = PP.U;
  var CH = PP.Characters;

  var canvas, ctx;
  var view = { w: 0, h: 0, dpr: 1, tile: 48, rowH: 42, baseY: 0 };
  var horizonY = 0;          // set each frame before the rows are drawn

  /* Deterministic per-tile randomness — same result every frame, no state. */
  function hash(a, b) {
    var h = (a | 0) * 374761393 + (b | 0) * 668265263 + 1013904223;
    h = (h ^ (h >>> 13)) >>> 0;
    h = (h * 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /* Small tiling noise textures, built once and reused as fill patterns. */
  var patterns = {};

  function makePattern(name, size, paint) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var g = c.getContext('2d');
    paint(g, size);
    patterns[name] = ctx.createPattern(c, 'repeat');
  }

  function buildPatterns() {
    makePattern('asphalt', 64, function (g, s) {
      for (var i = 0; i < 110; i++) {
        g.fillStyle = hash(i, 37) < 0.45 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.11)';
        g.fillRect(Math.floor(hash(i, 11) * s), Math.floor(hash(i, 23) * s), 2, 2);
      }
    });
    makePattern('ballast', 64, function (g, s) {
      for (var i = 0; i < 80; i++) {
        var c2 = hash(i, 83);
        g.fillStyle = c2 < 0.33 ? 'rgba(255,255,255,0.10)'
          : (c2 < 0.66 ? 'rgba(0,0,0,0.17)' : 'rgba(122,100,78,0.20)');
        g.fillRect(Math.floor(hash(i, 51) * s), Math.floor(hash(i, 67) * s), 2, 2);
      }
    });
  }

  function resize() {
    var w = canvas.clientWidth || global.innerWidth;
    var h = canvas.clientHeight || global.innerHeight;
    var dpr = Math.min(global.devicePixelRatio || 1, 2);

    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    view.w = w;
    view.h = h;
    view.dpr = dpr;
    // Fit roughly 11 columns across, but never let tiles get silly.
    view.tile = U.clamp(Math.min(w / 11, h / 12), 26, 96);
    view.rowH = view.tile * 0.84;
    view.baseY = h * 0.64;
  }

  function sx(wx, cam) { return view.w / 2 + (wx - cam.x) * view.tile; }
  function sy(row, cam) { return view.baseY - (row - cam.row) * view.rowH; }

  /* The one light source: a long soft shadow cast toward the lower left. */
  function longShadow(x, y, len, girth, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, 0.45);
    ctx.rotate(2.62);
    ctx.globalAlpha *= (alpha === undefined ? 0.14 : alpha);
    ctx.fillStyle = '#160b26';
    U.ellipse(ctx, len * 0.5, 0, len * 0.55, girth);
    ctx.fill();
    ctx.restore();
  }

  /* ── Backdrop ───────────────────────────────────────────────────── */

  function drawSky(cam, t) {
    var hz = horizonY;
    var g = ctx.createLinearGradient(0, 0, 0, hz + 40);
    g.addColorStop(0, '#191026');
    g.addColorStop(0.42, '#43203f');
    g.addColorStop(0.72, '#8a4148');
    g.addColorStop(0.92, '#d8874f');
    g.addColorStop(1, '#f4b463');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.w, hz + 42);

    // First stars, only high where the dusk is already deep.
    ctx.fillStyle = '#ffe9c8';
    var i;
    for (i = 0; i < 24; i++) {
      var stx = hash(i, 91) * view.w;
      var sty = hash(i, 57) * hz * 0.42;
      var tw = 0.1 + 0.5 * Math.max(0, Math.sin(t * (1.2 + hash(i, 3)) + i * 2.1));
      ctx.globalAlpha = Math.max(0, tw * (1 - sty / (hz * 0.5)));
      ctx.fillRect(stx, sty, 1.6, 1.6);
    }
    ctx.globalAlpha = 1;

    // Slow flat clouds, barely lighter than the sky.
    for (i = 0; i < 4; i++) {
      var cw = view.w * (0.14 + 0.1 * hash(i, 9));
      var cx = U.mod(hash(i, 11) * view.w + t * (2.5 + i) - cam.x * view.tile * 0.04, view.w + cw * 2) - cw;
      var cy = hz * (0.2 + 0.15 * hash(i, 7));
      ctx.fillStyle = 'rgba(46,29,62,0.42)';
      ctx.beginPath();
      ctx.ellipse(cx, cy, cw * 0.55, cw * 0.14, 0, 0, Math.PI * 2);
      ctx.ellipse(cx - cw * 0.3, cy + cw * 0.04, cw * 0.32, cw * 0.1, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + cw * 0.33, cy + cw * 0.05, cw * 0.3, cw * 0.09, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // The low sun, with a halo and a flat band of flare along the horizon.
    var sunX = view.w * 0.72, sunY = hz - view.h * 0.045;
    var sunR = Math.min(view.w, view.h) * 0.05;
    var halo = ctx.createRadialGradient(sunX, sunY, sunR * 0.4, sunX, sunY, sunR * 3.4);
    halo.addColorStop(0, 'rgba(255,196,120,0.36)');
    halo.addColorStop(1, 'rgba(255,196,120,0)');
    ctx.fillStyle = halo;
    U.ellipse(ctx, sunX, sunY, sunR * 3.4, sunR * 3.4);
    ctx.fill();
    ctx.fillStyle = '#ffedc2';
    U.ellipse(ctx, sunX, sunY, sunR, sunR);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,180,100,0.12)';
    U.ellipse(ctx, sunX, sunY, view.w * 0.4, sunR * 0.55);
    ctx.fill();

    // Skyline in two parallax layers; the far one owns the smokestacks.
    var off2 = U.mod(cam.x * view.tile * 0.12, 90);
    for (i = -1; i < view.w / 90 + 2; i++) {
      var bx2 = i * 90 - off2;
      var bh2 = 22 + ((i * 29) % 4) * 11;
      ctx.fillStyle = 'rgba(88,52,84,0.42)';
      ctx.fillRect(bx2, hz - bh2, 70, bh2);
      if (((i % 5) + 5) % 5 === 2) {
        ctx.fillRect(bx2 + 52, hz - bh2 - 26, 9, 26);
        ctx.fillStyle = '#9c8ba0';
        for (var sm = 0; sm < 3; sm++) {
          var ph = U.mod(t * 0.22 + sm / 3 + i * 0.13, 1);
          ctx.globalAlpha = (1 - ph) * 0.28;
          U.ellipse(ctx, bx2 + 56 + ph * 26 + Math.sin(t + sm) * 3,
            hz - bh2 - 28 - ph * 30, 6 + ph * 10, 5 + ph * 7);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }
    var off = U.mod(cam.x * view.tile * 0.25, 120);
    for (i = -1; i < view.w / 120 + 2; i++) {
      var bx = i * 120 - off;
      var bh = 38 + ((i * 37) % 5) * 15;
      ctx.fillStyle = 'rgba(34,22,44,0.88)';
      ctx.fillRect(bx, hz - bh, 96, bh);
      ctx.fillStyle = 'rgba(255,186,110,0.14)';
      for (var wy = 0; wy < bh - 14; wy += 14) {
        for (var wx2 = 0; wx2 < 80; wx2 += 18) {
          if (((i * 7 + wy + wx2) % 5) < 2) ctx.fillRect(bx + 8 + wx2, hz - bh + 8 + wy, 8, 7);
        }
      }
    }

    // Warm haze pooling where the city meets the ground.
    var hzg = ctx.createLinearGradient(0, hz - 26, 0, hz + 56);
    hzg.addColorStop(0, 'rgba(244,180,99,0)');
    hzg.addColorStop(1, 'rgba(150,84,66,0.5)');
    ctx.fillStyle = hzg;
    ctx.fillRect(0, hz - 26, view.w, 84);
  }

  /* ── Terrain bands ──────────────────────────────────────────────── */

  function drawBand(row, cam, t) {
    var top = sy(row.index, cam) - view.rowH / 2;
    var h = view.rowH;
    var x0 = 0, x1 = view.w;
    var col, c0, c1;
    var above, below;

    if (row.type === 'grass') {
      var even = row.index % 2 === 0;
      ctx.fillStyle = even ? '#569441' : '#5fa049';
      ctx.fillRect(x0, top, x1, h);

      // The Crossy signature: per-tile checkering, kept very quiet.
      c0 = Math.floor(cam.x - (view.w / view.tile) / 2) - 1;
      c1 = c0 + Math.ceil(view.w / view.tile) + 2;
      ctx.fillStyle = 'rgba(255,250,215,0.055)';
      for (col = c0; col <= c1; col++) {
        if (U.mod(col + row.index, 2) === 0) {
          ctx.fillRect(sx(col, cam) - view.tile / 2, top, view.tile + 0.5, h);
        }
      }

      // Mottled darker patches and the odd wildflower, fixed per tile.
      for (col = c0; col <= c1; col++) {
        var r1 = hash(row.index * 13 + 5, col);
        if (r1 < 0.14) {
          ctx.fillStyle = 'rgba(26,64,22,0.12)';
          U.ellipse(ctx, sx(col, cam) + (r1 * 6 - 0.4) * view.tile * 0.5,
            top + h * (0.25 + U.mod(r1 * 91, 0.5)), view.tile * 0.3, view.tile * 0.12);
          ctx.fill();
        }
        var r2 = hash(row.index * 13 + 9, col);
        if (r2 < 0.1 && !(row.blocked && row.blocked[col])) {
          var fx = sx(col, cam) + (r2 * 8 - 0.45) * view.tile * 0.6;
          var fy = top + h * (0.3 + U.mod(r2 * 137, 0.45));
          ctx.fillStyle = ['#ef8a6a', '#b48ad0', '#e8e0f2'][(r2 * 997 | 0) % 3];
          U.ellipse(ctx, fx, fy, view.tile * 0.035, view.tile * 0.035);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,246,200,0.5)';
          U.ellipse(ctx, fx, fy, view.tile * 0.010, view.tile * 0.010);
          ctx.fill();
        }
      }

      // Sun catches the far edge; the near edge steps down into shadow.
      ctx.fillStyle = 'rgba(255,240,190,0.10)';
      ctx.fillRect(x0, top, x1, h * 0.09);
      ctx.fillStyle = 'rgba(0,0,0,0.14)';
      ctx.fillRect(x0, top + h * 0.92, x1, h * 0.08);
    } else if (row.type === 'road') {
      ctx.fillStyle = '#37333e';
      ctx.fillRect(x0, top, x1, h);
      if (patterns.asphalt) {
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = patterns.asphalt;
        ctx.fillRect(x0, top, x1, h);
        ctx.globalAlpha = 1;
      }
      // Wheel-worn tracks where the traffic actually runs.
      ctx.fillStyle = 'rgba(0,0,0,0.10)';
      ctx.fillRect(x0, top + h * 0.30, x1, h * 0.13);
      ctx.fillRect(x0, top + h * 0.62, x1, h * 0.13);
      ctx.fillStyle = 'rgba(0,0,0,0.20)';
      ctx.fillRect(x0, top, x1, h * 0.08);

      above = PP.World.row(row.index + 1);
      below = row.index > 0 ? PP.World.row(row.index - 1) : null;
      if (above && above.type === 'road') {
        // Shared boundary between two lanes: a dashed divider, anchored
        // to the world so it doesn't swim when the camera pans.
        ctx.strokeStyle = 'rgba(238,224,196,0.32)';
        ctx.lineWidth = Math.max(2, view.tile * 0.045);
        ctx.setLineDash([view.tile * 0.45, view.tile * 0.5]);
        ctx.lineDashOffset = U.mod(cam.x * view.tile, view.tile * 0.95);
        ctx.beginPath();
        ctx.moveTo(0, top + 1);
        ctx.lineTo(view.w, top + 1);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
      } else {
        ctx.fillStyle = 'rgba(238,224,196,0.30)';
        ctx.fillRect(x0, top + h * 0.05, x1, Math.max(2, h * 0.035));
      }
      if (!(below && below.type === 'road')) {
        ctx.fillStyle = 'rgba(238,224,196,0.30)';
        ctx.fillRect(x0, top + h * 0.92, x1, Math.max(2, h * 0.035));
      }
    } else if (row.type === 'water') {
      // Water blushes toward the horizon, reflecting the dusk.
      var wf = U.clamp(1 - (top - horizonY) / (view.h * 0.55), 0, 1);
      var grad = ctx.createLinearGradient(0, top, 0, top + h);
      grad.addColorStop(0, U.mixHex('#1c4d78', '#8a5a64', wf * 0.55));
      grad.addColorStop(1, U.mixHex('#2b6f9d', '#a06a5e', wf * 0.35));
      ctx.fillStyle = grad;
      ctx.fillRect(x0, top, x1, h);

      // Specular glints drifting with the current.
      ctx.fillStyle = 'rgba(255,230,190,0.5)';
      for (var k = 0; k < 9; k++) {
        var gp = U.mod(hash(row.index, k) * (view.w + 80) +
          t * row.dir * row.speed * view.tile * 0.55, view.w + 80) - 40;
        var gy = top + h * (0.18 + U.mod(hash(row.index, k + 40) * 7, 0.62));
        ctx.globalAlpha = Math.max(0, 0.16 + 0.16 * Math.sin(t * 2.4 + k * 1.7 + row.index));
        ctx.fillRect(gp, gy, view.tile * (0.16 + hash(row.index, k + 80) * 0.22), Math.max(1.5, view.tile * 0.03));
      }
      ctx.globalAlpha = 1;

      // Faint travelling ripple arcs.
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 2;
      for (k = 0; k < 6; k++) {
        var phase = t * (row.dir > 0 ? 26 : -26) + k * 100 + row.index * 31;
        var rx = U.mod(phase, view.w + 120) - 60;
        var ry = top + h * (0.25 + ((k * 3 + row.index) % 3) * 0.22);
        ctx.beginPath();
        ctx.arc(rx, ry + 6, 12, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }

      above = PP.World.row(row.index + 1);
      below = row.index > 0 ? PP.World.row(row.index - 1) : null;
      if (!(above && above.type === 'water')) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';       // bank shadow
        ctx.fillRect(x0, top, x1, h * 0.10);
      }
      if (!(below && below.type === 'water')) {
        ctx.fillStyle = 'rgba(255,255,255,0.14)'; // waterline sparkle
        ctx.fillRect(x0, top + h - 2, x1, 2);
      }
    } else if (row.type === 'ice') {
      // A frozen river: pale, glassy, faintly blushing at the horizon.
      var wf2 = U.clamp(1 - (top - horizonY) / (view.h * 0.55), 0, 1);
      var ig = ctx.createLinearGradient(0, top, 0, top + h);
      ig.addColorStop(0, U.mixHex('#7fa8c4', '#a88a92', wf2 * 0.4));
      ig.addColorStop(1, U.mixHex('#93bdd4', '#b29592', wf2 * 0.0 + 0));
      ctx.fillStyle = ig;
      ctx.fillRect(x0, top, x1, h);
      // Frost sparkles.
      ctx.fillStyle = '#ffffff';
      for (var sp2 = 0; sp2 < 10; sp2++) {
        var spx2 = hash(row.index, sp2 + 200) * view.w;
        var spy2 = top + h * (0.15 + U.mod(hash(row.index, sp2 + 300) * 7, 0.7));
        ctx.globalAlpha = Math.max(0, 0.25 * Math.sin(t * 2 + sp2 * 2.2 + row.index));
        ctx.fillRect(spx2, spy2, 2, 2);
      }
      ctx.globalAlpha = 1;
      above = PP.World.row(row.index + 1);
      below = row.index > 0 ? PP.World.row(row.index - 1) : null;
      if (!(above && above.type === 'ice')) {
        ctx.fillStyle = 'rgba(0,0,0,0.20)';
        ctx.fillRect(x0, top, x1, h * 0.09);
      }
      if (!(below && below.type === 'ice')) {
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(x0, top + h - 2, x1, 2);
      }
    } else if (row.type === 'parade') {
      // A paved parade route with a red runner and bunting.
      ctx.fillStyle = '#4a4450';
      ctx.fillRect(x0, top, x1, h);
      if (patterns.asphalt) {
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = patterns.asphalt;
        ctx.fillRect(x0, top, x1, h);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = 'rgba(165,20,36,0.30)';
      ctx.fillRect(x0, top + h * 0.24, x1, h * 0.55);
      ctx.fillStyle = 'rgba(245,197,66,0.25)';
      ctx.fillRect(x0, top + h * 0.24, x1, 2);
      ctx.fillRect(x0, top + h * 0.79 - 2, x1, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.20)';
      ctx.fillRect(x0, top, x1, h * 0.08);
      // Bunting along the far edge, anchored to the world.
      var bstep = view.tile * 0.5;
      for (var bx3 = U.mod(-cam.x * view.tile, bstep) - bstep; bx3 < view.w; bx3 += bstep) {
        ctx.fillStyle = ((bx3 / bstep) | 0) % 2 ? '#c8102e' : '#f5c542';
        ctx.beginPath();
        ctx.moveTo(bx3, top + 2);
        ctx.lineTo(bx3 + bstep * 0.5, top + 2);
        ctx.lineTo(bx3 + bstep * 0.25, top + h * 0.14);
        ctx.closePath();
        ctx.fill();
      }
    } else if (row.type === 'checkpoint') {
      ctx.fillStyle = '#6b6155';
      ctx.fillRect(x0, top, x1, h);
      if (patterns.ballast) {
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = patterns.ballast;
        ctx.fillRect(x0, top, x1, h);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = 'rgba(0,0,0,0.20)';
      ctx.fillRect(x0, top, x1, h * 0.08);
    } else if (row.type === 'rail') {
      ctx.fillStyle = '#665d50';
      ctx.fillRect(x0, top, x1, h);
      if (patterns.ballast) {
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = patterns.ballast;
        ctx.fillRect(x0, top, x1, h);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(x0, top, x1, h * 0.09);
      // Sleepers, anchored to the world.
      ctx.fillStyle = '#463a2d';
      var step = view.tile * 0.55;
      for (var sxp = U.mod(-cam.x * view.tile, step) - step; sxp < view.w; sxp += step) {
        ctx.fillRect(sxp, top + h * 0.2, step * 0.42, h * 0.6);
      }
      // Rails: dark base, bright sun glint along the top edge.
      ctx.fillStyle = '#57504a';
      ctx.fillRect(x0, top + h * 0.30, x1, Math.max(2.5, h * 0.075));
      ctx.fillRect(x0, top + h * 0.63, x1, Math.max(2.5, h * 0.075));
      ctx.fillStyle = 'rgba(235,222,200,0.55)';
      ctx.fillRect(x0, top + h * 0.30, x1, 1.5);
      ctx.fillRect(x0, top + h * 0.63, x1, 1.5);
    }
  }

  /* ── Scenery ────────────────────────────────────────────────────── */

  function drawFence(row, cam) {
    var y = sy(row.index, cam) + view.rowH * 0.30;
    var s = view.tile;
    var gapL = sx(-0.55, cam), gapR = sx(0.55, cam);

    ctx.fillStyle = '#7a5c3a';
    for (var x = PP.World.CFG.X_MIN - 1; x <= PP.World.CFG.X_MAX + 1; x += 1) {
      if (x === 0) continue;                    // the gate you bolted through
      var px = sx(x, cam);
      ctx.fillRect(px - s * 0.05, y - s * 0.42, s * 0.10, s * 0.42);
    }
    // Rails, split around the open gate.
    [[0, gapL], [gapR, view.w]].forEach(function (seg) {
      var w2 = Math.max(0, seg[1] - seg[0]);
      ctx.fillRect(seg[0], y - s * 0.34, w2, s * 0.07);
      ctx.fillRect(seg[0], y - s * 0.18, w2, s * 0.07);
    });
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(0, y - s * 0.11, view.w, s * 0.04);

    // Both gate leaves flung wide toward the camera, still swinging.
    var t2 = PP.World.time();
    [[gapL, 1], [gapR, -1]].forEach(function (gate) {
      ctx.save();
      longShadow(gate[0] + gate[1] * s * 0.2, y + s * 0.06, s * 0.4, s * 0.08, 0.1);
      ctx.translate(gate[0], y - s * 0.30);
      ctx.rotate(gate[1] * (0.92 + Math.sin(t2 * 1.1 + gate[1]) * 0.05));
      ctx.fillStyle = '#9a7a50';
      ctx.fillRect(0, -s * 0.035, s * 0.46 * gate[1], s * 0.07);
      ctx.fillRect(0, s * 0.10, s * 0.46 * gate[1], s * 0.07);
      ctx.fillRect(gate[1] * s * 0.38, -s * 0.05, gate[1] * s * 0.08, s * 0.26);
      ctx.restore();
    });

    // The supper you abandoned: a tipped bowl, kibble everywhere.
    var bx = sx(0.85, cam), by = y + s * 0.14;
    ctx.fillStyle = '#8a352d';
    U.ellipse(ctx, bx, by, s * 0.12, s * 0.05);
    ctx.fill();
    ctx.fillStyle = '#b34a3f';
    U.ellipse(ctx, bx - s * 0.02, by - s * 0.035, s * 0.10, s * 0.04);
    ctx.fill();
    ctx.fillStyle = '#e8c07a';
    [[-0.22, 0.05], [-0.3, 0.1], [-0.16, 0.12]].forEach(function (kb) {
      U.ellipse(ctx, bx + kb[0] * s, by + kb[1] * s, s * 0.025, s * 0.02);
      ctx.fill();
    });
  }

  function drawDecor(row, d, cam, t) {
    var x = sx(d.x, cam);
    var y = sy(row.index, cam) + view.rowH * 0.22;
    var s = view.tile;

    ctx.save();
    if (d.kind === 'tree') {
      var th = s * d.h;
      var sway = Math.sin(t * 1.4 + d.seed * 9) * s * 0.02;
      longShadow(x, y, th * 1.0, s * 0.28);
      ctx.fillStyle = 'rgba(40,24,58,0.24)';
      U.ellipse(ctx, x, y, s * 0.30, s * 0.11);
      ctx.fill();

      if (d.seed < 0.35) {
        // Conifer: a stack of shaded wedges.
        ctx.fillStyle = '#4c3722';
        ctx.fillRect(x - s * 0.07, y - th * 0.3, s * 0.14, th * 0.3);
        var layers = 3;
        for (var li = 0; li < layers; li++) {
          var f = li / layers;
          var lw = s * (0.44 - f * 0.13);
          var base = y - th * (0.22 + f * 0.30);
          var tip = y - th * (0.58 + f * 0.30);
          ctx.fillStyle = li % 2 ? '#356e3b' : '#2c5b33';
          ctx.beginPath();
          ctx.moveTo(x - lw + sway * f, base);
          ctx.lineTo(x + sway * (f + 0.5), tip);
          ctx.lineTo(x + lw + sway * f, base);
          ctx.closePath();
          ctx.fill();
          // Sun-side edge.
          ctx.fillStyle = 'rgba(255,214,140,0.14)';
          ctx.beginPath();
          ctx.moveTo(x + sway * (f + 0.5), tip);
          ctx.lineTo(x + lw + sway * f, base);
          ctx.lineTo(x + lw * 0.55 + sway * f, base);
          ctx.closePath();
          ctx.fill();
        }
      } else {
        ctx.fillStyle = '#5b3d26';
        ctx.fillRect(x - s * 0.09, y - th * 0.45, s * 0.18, th * 0.45);
        var lay = 3;
        for (var i = 0; i < lay; i++) {
          var ff = i / (lay - 1);
          ctx.fillStyle = i === 0 ? '#2f6b34' : (i === 1 ? '#38803d' : '#43964a');
          U.ellipse(ctx, x + sway * (0.4 + ff), y - th * (0.42 + ff * 0.42),
            s * (0.42 - ff * 0.10), s * (0.28 - ff * 0.06));
          ctx.fill();
        }
        // Warm rim where the sun grazes the canopy.
        ctx.fillStyle = 'rgba(255,214,140,0.18)';
        U.ellipse(ctx, x + s * 0.15 + sway * 1.4, y - th * 0.88, s * 0.16, s * 0.09);
        ctx.fill();
      }
    } else if (d.kind === 'bush') {
      longShadow(x, y, s * 0.45, s * 0.20);
      ctx.fillStyle = 'rgba(40,24,58,0.22)';
      U.ellipse(ctx, x, y, s * 0.30, s * 0.10);
      ctx.fill();
      ctx.fillStyle = '#356f39';
      U.ellipse(ctx, x - s * 0.13, y - s * 0.14, s * 0.22, s * 0.18);
      ctx.fill();
      U.ellipse(ctx, x + s * 0.13, y - s * 0.16, s * 0.20, s * 0.17);
      ctx.fill();
      ctx.fillStyle = '#40853f';
      U.ellipse(ctx, x, y - s * 0.26, s * 0.26, s * 0.21);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,214,140,0.16)';
      U.ellipse(ctx, x + s * 0.12, y - s * 0.34, s * 0.10, s * 0.06);
      ctx.fill();
      // A few berries.
      ctx.fillStyle = '#c94f4f';
      for (var bi = 0; bi < 3; bi++) {
        U.ellipse(ctx, x + (hash(row.index, bi + 7) - 0.5) * s * 0.4,
          y - s * (0.12 + hash(row.index, bi + 17) * 0.2), s * 0.025, s * 0.025);
        ctx.fill();
      }
    } else if (d.kind === 'rock') {
      longShadow(x, y, s * 0.5, s * 0.22);
      ctx.fillStyle = 'rgba(40,24,58,0.22)';
      U.ellipse(ctx, x, y, s * 0.32, s * 0.11);
      ctx.fill();
      ctx.fillStyle = '#8d8a86';
      ctx.beginPath();
      ctx.moveTo(x - s * 0.30, y);
      ctx.lineTo(x - s * 0.20, y - s * 0.34);
      ctx.lineTo(x + s * 0.06, y - s * 0.42);
      ctx.lineTo(x + s * 0.30, y - s * 0.12);
      ctx.lineTo(x + s * 0.24, y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,236,190,0.28)';
      ctx.beginPath();
      ctx.moveTo(x + s * 0.06, y - s * 0.42);
      ctx.lineTo(x + s * 0.30, y - s * 0.12);
      ctx.lineTo(x + s * 0.10, y - s * 0.16);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(53,111,57,0.5)';
      U.ellipse(ctx, x - s * 0.16, y - s * 0.05, s * 0.09, s * 0.04);
      ctx.fill();
    } else if (d.kind === 'bust') {
      longShadow(x, y, s * 0.9, s * 0.26);
      ctx.fillStyle = 'rgba(40,24,58,0.24)';
      U.ellipse(ctx, x, y, s * 0.34, s * 0.12);
      ctx.fill();
      ctx.fillStyle = '#8b8177';
      ctx.fillRect(x - s * 0.24, y - s * 0.52, s * 0.48, s * 0.52);
      ctx.fillStyle = '#9c9288';
      ctx.fillRect(x - s * 0.30, y - s * 0.58, s * 0.60, s * 0.10);
      ctx.fillStyle = '#b4a99c';
      U.roundRect(ctx, x - s * 0.17, y - s * 0.98, s * 0.34, s * 0.40, s * 0.10);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - s * 0.16, y - s * 0.94);
      ctx.lineTo(x - s * 0.10, y - s * 1.14);
      ctx.lineTo(x - s * 0.03, y - s * 0.94);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + s * 0.03, y - s * 0.94);
      ctx.lineTo(x + s * 0.10, y - s * 1.14);
      ctx.lineTo(x + s * 0.16, y - s * 0.94);
      ctx.closePath();
      ctx.fill();
      // Sunlit cheek.
      ctx.fillStyle = 'rgba(255,222,170,0.25)';
      U.ellipse(ctx, x + s * 0.09, y - s * 0.82, s * 0.05, s * 0.09);
      ctx.fill();
      ctx.fillStyle = '#c8102e';
      CH.star(ctx, x, y - s * 0.30, s * 0.11);
    } else if (d.kind === 'banner') {
      var wave = Math.sin(t * 3 + d.seed * 9) * s * 0.06;
      longShadow(x, y, s * 1.0, s * 0.10);
      ctx.fillStyle = 'rgba(40,24,58,0.22)';
      U.ellipse(ctx, x, y, s * 0.14, s * 0.06);
      ctx.fill();
      ctx.fillStyle = '#6d6259';
      ctx.fillRect(x - s * 0.03, y - s * 1.25, s * 0.06, s * 1.25);
      ctx.fillStyle = '#c8102e';
      ctx.beginPath();
      ctx.moveTo(x + s * 0.02, y - s * 1.22);
      ctx.lineTo(x + s * 0.56 + wave, y - s * 1.16);
      ctx.lineTo(x + s * 0.56 + wave, y - s * 0.68);
      ctx.lineTo(x + s * 0.02, y - s * 0.74);
      ctx.closePath();
      ctx.fill();
      // Shaded fold.
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.beginPath();
      ctx.moveTo(x + s * 0.28 + wave * 0.5, y - s * 1.19);
      ctx.lineTo(x + s * 0.40 + wave * 0.8, y - s * 1.18);
      ctx.lineTo(x + s * 0.40 + wave * 0.8, y - s * 0.71);
      ctx.lineTo(x + s * 0.28 + wave * 0.5, y - s * 0.72);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f5c542';
      CH.star(ctx, x + s * 0.29 + wave * 0.5, y - s * 0.96, s * 0.13);
    }
    ctx.restore();
  }

  function drawCoin(row, cam, t) {
    var c = row.coin;
    if (!c || c.taken) return;
    var x = sx(c.x, cam);
    var bob = Math.sin(t * 3 + c.bob) * view.tile * 0.07;
    var y = sy(row.index, cam) + view.rowH * 0.10 + bob;
    var s = view.tile;
    var squeeze = Math.abs(Math.cos(t * 2.2 + c.bob));
    var groundY = sy(row.index, cam) + view.rowH * 0.24;

    ctx.save();
    longShadow(x, groundY, s * 0.3, s * 0.09, 0.1);
    ctx.fillStyle = 'rgba(40,24,58,0.22)';
    U.ellipse(ctx, x, groundY, s * 0.16, s * 0.06);
    ctx.fill();

    ctx.translate(x, y);
    ctx.scale(0.35 + squeeze * 0.65, 1);
    // A gold bone: universal currency for cats and dogs alike.
    ctx.fillStyle = '#f5c542';
    U.roundRect(ctx, -s * 0.20, -s * 0.06, s * 0.40, s * 0.12, s * 0.05);
    ctx.fill();
    [-1, 1].forEach(function (sg) {
      U.ellipse(ctx, sg * s * 0.20, -s * 0.07, s * 0.09, s * 0.08);
      ctx.fill();
      U.ellipse(ctx, sg * s * 0.20, s * 0.07, s * 0.09, s * 0.08);
      ctx.fill();
    });
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    U.roundRect(ctx, -s * 0.14, -s * 0.04, s * 0.20, s * 0.035, s * 0.02);
    ctx.fill();
    ctx.restore();

    // An occasional four-point sparkle.
    var sp = Math.sin(t * 2.6 + c.bob * 2);
    if (sp > 0.82) {
      var a = (sp - 0.82) / 0.18;
      ctx.save();
      ctx.globalAlpha = a * 0.9;
      ctx.strokeStyle = '#fff3cf';
      ctx.lineWidth = 1.5;
      var spx = x + s * 0.16, spy = y - s * 0.12, r = s * 0.09 * a;
      ctx.beginPath();
      ctx.moveTo(spx - r, spy); ctx.lineTo(spx + r, spy);
      ctx.moveTo(spx, spy - r); ctx.lineTo(spx, spy + r);
      ctx.stroke();
      ctx.restore();
    }
  }

  /* ── Vehicles ───────────────────────────────────────────────────── */

  function headBeam(lampX, lampY, s) {
    ctx.globalCompositeOperation = 'lighter';
    var grad = ctx.createLinearGradient(lampX, 0, lampX + s * 2.0, 0);
    grad.addColorStop(0, 'rgba(255,190,110,0.18)');
    grad.addColorStop(1, 'rgba(255,190,110,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(lampX, lampY);
    ctx.lineTo(lampX + s * 2.0, lampY - s * 0.40);
    ctx.lineTo(lampX + s * 2.0, lampY + s * 0.32);
    ctx.closePath();
    ctx.fill();
    var rg = ctx.createRadialGradient(lampX - s * 0.06, lampY, 0, lampX - s * 0.06, lampY, s * 0.12);
    rg.addColorStop(0, 'rgba(255,217,160,0.28)');
    rg.addColorStop(1, 'rgba(255,217,160,0)');
    ctx.fillStyle = rg;
    U.ellipse(ctx, lampX - s * 0.06, lampY, s * 0.12, s * 0.12);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    // The lamp itself, so the glow has a visible source.
    ctx.fillStyle = '#ffd9a0';
    U.ellipse(ctx, lampX - s * 0.02, lampY, s * 0.04, s * 0.04);
    ctx.fill();
  }

  function exhaust(px, py, s, t, seed, scale) {
    ctx.fillStyle = '#8d867c';
    for (var k = 0; k < 3; k++) {
      var ph = U.mod(t * 0.8 + seed * 5 + k / 3, 1);
      ctx.globalAlpha = (1 - ph) * 0.15;
      U.ellipse(ctx, px - ph * s * 0.55 * scale, py - ph * s * 0.5 * scale,
        s * (0.05 + ph * 0.14) * scale, s * (0.05 + ph * 0.12) * scale);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawCar(row, car, cam, t) {
    var x = sx(PP.World.carX(row, car), cam);
    var y = sy(row.index, cam) + view.rowH * 0.26;
    var s = view.tile;
    var w = car.w * s;
    var dir = row.dir;

    if (x < -w - s * 2.5 || x > view.w + w + s * 2.5) return;

    ctx.save();
    longShadow(x, y + s * 0.02, w * 0.5, s * 0.15, 0.12);
    ctx.fillStyle = 'rgba(40,24,58,0.32)';
    U.ellipse(ctx, x, y, w * 0.46, s * 0.12);
    ctx.fill();

    // Suspension bob — treads only rumble.
    var bob = car.kind === 'tank'
      ? Math.sin(t * 23 + car.seed * 40) * s * 0.004
      : Math.sin(t * 7 + car.seed * 31) * s * 0.013;

    ctx.translate(x, y + bob);
    ctx.scale(dir, 1);

    var bodyH = s * 0.42;
    var base = -s * 0.06;

    // Wheels — and they actually roll: one spoke keyed to distance
    // travelled, plus an off-centre hub glint.
    ctx.fillStyle = '#1b1b20';
    [-w * 0.30, w * 0.30].forEach(function (wx) {
      U.ellipse(ctx, wx, base, s * 0.11, s * 0.11);
      ctx.fill();
    });
    if (car.kind !== 'tank') {
      var ang = car.p * 9;
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1.5;
      [-w * 0.30, w * 0.30].forEach(function (wx) {
        ctx.beginPath();
        ctx.moveTo(wx - Math.cos(ang) * s * 0.07, base - Math.sin(ang) * s * 0.07);
        ctx.lineTo(wx + Math.cos(ang) * s * 0.07, base + Math.sin(ang) * s * 0.07);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.30)';
        U.ellipse(ctx, wx, base, s * 0.026, s * 0.026);
        ctx.fill();
      });
    }

    if (car.kind === 'tank') {
      ctx.fillStyle = '#2a2a2e';
      U.roundRect(ctx, -w / 2, base - s * 0.16, w, s * 0.22, s * 0.09);
      ctx.fill();
      // Tread links, crawling with the direction of travel.
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      var linkStep = s * 0.16;
      var linkOff = U.mod(t * row.speed * view.tile * 0.4, linkStep);
      for (var lx = -w / 2 + linkOff; lx < w / 2; lx += linkStep) {
        ctx.fillRect(lx, base + s * 0.005, s * 0.05, s * 0.035);
      }
      ctx.fillStyle = car.color;
      U.roundRect(ctx, -w / 2 + s * 0.04, base - bodyH, w - s * 0.08, bodyH - s * 0.12, s * 0.06);
      ctx.fill();
      ctx.fillStyle = U.shade(car.color, 0.16);
      U.roundRect(ctx, -w * 0.14, base - bodyH - s * 0.26, w * 0.44, s * 0.28, s * 0.07);
      ctx.fill();
      ctx.fillRect(w * 0.28, base - bodyH - s * 0.16, w * 0.30, s * 0.06);
      ctx.fillStyle = '#c8102e';
      CH.star(ctx, -w * 0.22, base - bodyH * 0.55, s * 0.11);
      exhaust(-w * 0.45, base - bodyH, s, t, car.seed, 1.2);
    } else if (car.kind === 'truck') {
      ctx.fillStyle = U.shade(car.color, -0.2);
      U.roundRect(ctx, -w / 2, base - bodyH, w * 0.62, bodyH, s * 0.05);
      ctx.fill();
      ctx.fillStyle = '#8a7a63';
      U.roundRect(ctx, -w / 2 + s * 0.02, base - bodyH - s * 0.20, w * 0.58, s * 0.24, s * 0.08);
      ctx.fill();
      // Tarp ropes.
      ctx.strokeStyle = 'rgba(40,24,58,0.24)';
      ctx.lineWidth = 1.5;
      for (var rp = 1; rp < 4; rp++) {
        var rx2 = -w / 2 + s * 0.02 + (w * 0.58) * rp / 4;
        ctx.beginPath();
        ctx.moveTo(rx2, base - bodyH - s * 0.20);
        ctx.lineTo(rx2, base - bodyH + s * 0.04);
        ctx.stroke();
      }
      ctx.fillStyle = car.color;
      U.roundRect(ctx, w * 0.10, base - bodyH, w * 0.40, bodyH, s * 0.06);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,225,170,0.75)';
      U.roundRect(ctx, w * 0.18, base - bodyH + s * 0.05, w * 0.24, s * 0.15, s * 0.03);
      ctx.fill();
      ctx.fillStyle = '#c8102e';
      CH.star(ctx, -w * 0.20, base - bodyH * 0.5, s * 0.10);
      exhaust(-w * 0.46, base - bodyH - s * 0.18, s, t, car.seed, 1);
    } else if (car.kind === 'tractor') {
      ctx.fillStyle = '#1b1b20';
      U.ellipse(ctx, w * 0.28, base + s * 0.02, s * 0.17, s * 0.17);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      U.ellipse(ctx, w * 0.28, base + s * 0.02, s * 0.09, s * 0.09);
      ctx.fill();
      ctx.fillStyle = car.color;
      U.roundRect(ctx, -w / 2, base - bodyH * 0.8, w * 0.9, bodyH * 0.8, s * 0.05);
      ctx.fill();
      ctx.fillStyle = U.shade(car.color, -0.25);
      ctx.fillRect(-w * 0.34, base - bodyH * 1.35, s * 0.10, bodyH * 0.55);
      ctx.fillStyle = '#f5c542';
      CH.star(ctx, -w * 0.10, base - bodyH * 0.45, s * 0.09);
      exhaust(-w * 0.30, base - bodyH * 1.35, s, t, car.seed, 0.8);
    } else {
      ctx.fillStyle = car.color;
      U.roundRect(ctx, -w / 2, base - bodyH * 0.8, w, bodyH * 0.8, s * 0.07);
      ctx.fill();
      ctx.fillStyle = U.shade(car.color, 0.12);
      U.roundRect(ctx, -w * 0.28, base - bodyH * 1.28, w * 0.58, bodyH * 0.55, s * 0.06);
      ctx.fill();
      // Dusk-lit glass: cool with a warm sun streak.
      ctx.fillStyle = 'rgba(150,190,215,0.8)';
      U.roundRect(ctx, -w * 0.22, base - bodyH * 1.2, w * 0.22, bodyH * 0.38, s * 0.03);
      ctx.fill();
      U.roundRect(ctx, w * 0.04, base - bodyH * 1.2, w * 0.22, bodyH * 0.38, s * 0.03);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,210,150,0.35)';
      var stL = dir > 0 ? w * 0.06 : -w * 0.14;
      ctx.fillRect(stL, base - bodyH * 1.18, w * 0.08, bodyH * 0.32);
      ctx.fillStyle = '#c8102e';
      CH.star(ctx, -w * 0.38, base - bodyH * 0.42, s * 0.09);
    }

    // Sun catches every roof.
    ctx.fillStyle = 'rgba(255,214,150,0.26)';
    ctx.fillRect(-w * 0.46, base - (car.kind === 'tank' ? bodyH + s * 0.24 : bodyH * (car.kind === 'sedan' || car.kind === 'jeep' ? 1.26 : 1.0)) - 1.5, w * 0.9, 2.5);

    // Lights: warm beam forward, ember behind.
    headBeam(w * 0.48, base - s * 0.16, s);
    ctx.fillStyle = 'rgba(255,80,60,0.22)';
    U.ellipse(ctx, -w * 0.48, base - s * 0.14, s * 0.09, s * 0.07);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,90,70,0.95)';
    U.ellipse(ctx, -w * 0.48, base - s * 0.14, s * 0.035, s * 0.035);
    ctx.fill();

    // The driver: someone's very loyal pet.
    if (car.kind !== 'tank') {
      var skin = CH.enemySkin(car.skin);
      ctx.save();
      ctx.translate(car.kind === 'truck' ? w * 0.24 : 0, base - bodyH * (car.kind === 'truck' ? 1.0 : 1.28));
      CH.draw(ctx, 0, s * 0.30, {
        size: s * 0.52, char: skin, facing: 'right',
        cap: car.seed < 0.5 ? 'ushanka' : 'cap'
      });
      ctx.restore();
    }
    ctx.restore();
  }

  function drawTrain(row, cam, t) {
    var s = view.tile;
    var x = sx(row.trainX, cam);
    var w = row.trainW * s;
    var y = sy(row.index, cam) + view.rowH * 0.26;

    ctx.save();
    ctx.fillStyle = 'rgba(40,24,58,0.35)';
    ctx.fillRect(x - w / 2, y - s * 0.05, w, s * 0.12);
    ctx.translate(x, y);
    ctx.scale(row.dir, 1);

    var h = s * 0.62;
    // Speed streaks trailing the cars.
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255,220,180,0.10)';
    ctx.lineWidth = Math.max(2, s * 0.05);
    for (var st2 = 0; st2 < 3; st2++) {
      var sy2 = -h * (0.25 + st2 * 0.25);
      ctx.beginPath();
      ctx.moveTo(-w / 2 - s * (0.4 + st2 * 0.5), sy2);
      ctx.lineTo(-w / 2 + s * 1.2, sy2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = '#6d1622';
    U.roundRect(ctx, -w / 2, -h, w, h, s * 0.10);
    ctx.fill();
    ctx.fillStyle = '#8d1f2d';
    U.roundRect(ctx, -w / 2 + s * 0.06, -h + s * 0.05, w - s * 0.12, h * 0.35, s * 0.06);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,232,180,0.8)';
    for (var i = 0; i < row.trainW - 1; i++) {
      ctx.fillRect(-w / 2 + s * 0.35 + i * s, -h + s * 0.12, s * 0.42, s * 0.18);
    }
    ctx.fillStyle = 'rgba(255,214,150,0.14)';
    ctx.fillRect(-w / 2, -h - 1.5, w, 2.5);
    ctx.fillStyle = '#f5c542';
    CH.star(ctx, w * 0.36, -h * 0.42, s * 0.16);

    // Stack smoke pouring off the engine.
    ctx.fillStyle = '#a99aa5';
    for (var k = 0; k < 5; k++) {
      var ph = U.mod(t * 0.7 + k / 5, 1);
      ctx.globalAlpha = (1 - ph) * 0.45;
      U.ellipse(ctx, w / 2 - s * 0.5 - ph * s * 2.4, -h - s * 0.25 - ph * s * 0.9,
        s * (0.1 + ph * 0.3), s * (0.09 + ph * 0.22));
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    headBeam(w / 2 - s * 0.08, -h * 0.55, s * 1.6);
    ctx.restore();
  }

  function drawRailSignals(row, cam, t) {
    if (row.state === 'idle') return;
    var s = view.tile;
    var y = sy(row.index, cam) + view.rowH * 0.24;
    // The boom arm drops through the warning with a little overshoot,
    // and stays down while the train passes.
    var k = row.state === 'warn' ? U.clamp(row.lit / 1.0, 0, 1) : 1;
    var ease = 1 - Math.pow(1 - k, 3);
    if (row.state === 'warn') ease += Math.sin(Math.min(k * 1.2, 1) * Math.PI) * 0.05;
    [-1, 1].forEach(function (side) {
      // World-anchored: the posts stand just outside the corridor and
      // stay put no matter where the camera pans.
      var x = sx(side < 0 ? PP.World.CFG.X_MIN - 0.8 : PP.World.CFG.X_MAX + 0.8, cam);
      if (x < -s || x > view.w + s) return;
      ctx.fillStyle = '#4a4038';
      ctx.fillRect(x - s * 0.04, y - s * 0.9, s * 0.08, s * 0.9);
      ctx.save();
      ctx.translate(x, y - s * 0.86);
      ctx.rotate(-side * ease * Math.PI / 2);
      var seg = s * 0.85 / 4;
      for (var a2 = 0; a2 < 4; a2++) {
        ctx.fillStyle = a2 % 2 ? '#f0e6d6' : '#c8102e';
        ctx.fillRect(-s * 0.035, -s * 0.85 + a2 * seg, s * 0.07, seg + 0.5);
      }
      ctx.restore();
      // Lamps blink in anti-phase, so the crossing is never dark mid-warning.
      var lit2 = Math.sin(t * 8 + (side > 0 ? Math.PI : 0)) > 0;
      ctx.fillStyle = lit2 ? '#ff3b30' : '#a03028';
      U.ellipse(ctx, x, y - s * 0.98, s * 0.13, s * 0.13);
      ctx.fill();
      if (lit2) {
        var halo2 = ctx.createRadialGradient(x, y - s * 0.98, 0, x, y - s * 0.98, s * 0.42);
        halo2.addColorStop(0, 'rgba(255,59,48,0.38)');
        halo2.addColorStop(1, 'rgba(255,59,48,0)');
        ctx.fillStyle = halo2;
        U.ellipse(ctx, x, y - s * 0.98, s * 0.42, s * 0.42);
        ctx.fill();
      }
    });
  }

  function drawLog(row, lg, cam, t) {
    var x = sx(PP.World.logX(row, lg), cam);
    var s = view.tile;
    var w = lg.w * s;
    var bob = Math.sin(t * 2.1 + lg.seed * 12) * s * 0.02;
    var y = sy(row.index, cam) + view.rowH * 0.20 + bob;
    if (x < -w || x > view.w + w) return;

    ctx.save();
    // Reflection-shadow, wobbling gently on the surface.
    var wob = Math.sin(t * 3 + lg.seed * 9) * 2;
    ctx.fillStyle = 'rgba(8,20,40,0.28)';
    U.ellipse(ctx, x - s * 0.08 + wob, y + s * 0.13, w * 0.46, s * 0.09);
    ctx.fill();

    // Wake rippling off the trailing end.
    ctx.strokeStyle = 'rgba(255,255,255,0.20)';
    ctx.lineWidth = 1.5;
    var tail = x - row.dir * (w / 2 + s * 0.08);
    for (var wk = 0; wk < 2; wk++) {
      var wph = U.mod(t * 1.6 + wk * 0.5 + lg.seed, 1);
      ctx.globalAlpha = (1 - wph) * 0.5;
      ctx.beginPath();
      ctx.arc(tail - row.dir * wph * s * 0.5, y + s * 0.02, s * (0.08 + wph * 0.1),
        Math.PI * 0.2, Math.PI * 0.8);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    if (lg.kind === 'raft') {
      ctx.fillStyle = '#9a6b3d';
      U.roundRect(ctx, x - w / 2, y - s * 0.18, w, s * 0.26, s * 0.05);
      ctx.fill();
      // Waterline: the raft sits in the river, not on it.
      ctx.fillStyle = 'rgba(12,35,58,0.35)';
      U.roundRect(ctx, x - w / 2, y + s * 0.02, w, s * 0.06, s * 0.03);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 2;
      for (var i = 1; i < lg.w * 2; i++) {
        var px = x - w / 2 + (i * w) / (lg.w * 2);
        ctx.beginPath();
        ctx.moveTo(px, y - s * 0.18);
        ctx.lineTo(px, y + s * 0.08);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,214,150,0.18)';
      ctx.fillRect(x - w / 2, y - s * 0.18, w, 2);
      // Crate with an optimistic slogan on it.
      ctx.fillStyle = '#7d5a33';
      U.roundRect(ctx, x + w * 0.22, y - s * 0.52, s * 0.34, s * 0.34, s * 0.04);
      ctx.fill();
      ctx.fillStyle = '#c8102e';
      CH.star(ctx, x + w * 0.22 + s * 0.17, y - s * 0.35, s * 0.10);
    } else {
      ctx.fillStyle = '#7d5230';
      U.roundRect(ctx, x - w / 2, y - s * 0.22, w, s * 0.34, s * 0.16);
      ctx.fill();
      // Waterline: the log sits in the river, not on it.
      ctx.fillStyle = 'rgba(12,35,58,0.35)';
      U.roundRect(ctx, x - w / 2, y + s * 0.03, w, s * 0.09, s * 0.05);
      ctx.fill();
      ctx.fillStyle = '#8e6039';
      U.roundRect(ctx, x - w / 2 + s * 0.05, y - s * 0.20, w - s * 0.1, s * 0.14, s * 0.07);
      ctx.fill();
      // Wet gleam along the sun side.
      ctx.fillStyle = 'rgba(255,214,150,0.22)';
      U.roundRect(ctx, x + w / 2 - s * 0.08 - (w - s * 0.5), y - s * 0.215, w - s * 0.5, s * 0.045, s * 0.02);
      ctx.fill();
      ctx.fillStyle = '#a9763f';
      [-1, 1].forEach(function (sg) {
        U.ellipse(ctx, x + sg * (w / 2 - s * 0.02), y - s * 0.05, s * 0.07, s * 0.17);
        ctx.fill();
      });
      ctx.strokeStyle = '#6a4526';
      ctx.lineWidth = 2;
      [-1, 1].forEach(function (sg) {
        U.ellipse(ctx, x + sg * (w / 2 - s * 0.02), y - s * 0.05, s * 0.035, s * 0.09);
        ctx.stroke();
      });
    }
    ctx.restore();
  }

  function drawFloes(row, cam, t) {
    var s = view.tile;
    var y = sy(row.index, cam) + view.rowH * 0.16;
    for (var key in row.floes) {
      if (!Object.prototype.hasOwnProperty.call(row.floes, key)) continue;
      var f = row.floes[key];
      var x = sx(+key, cam);
      if (x < -s || x > view.w + s) continue;

      if (f.state === 'sunk') {
        // The hole it left: dark water with a shiver of rings.
        ctx.fillStyle = 'rgba(20,50,80,0.55)';
        U.ellipse(ctx, x, y + s * 0.04, s * 0.34, s * 0.15);
        ctx.fill();
        continue;
      }

      var bob = Math.sin(t * 1.7 + f.seed * 9) * s * 0.012;
      var dip = Math.min(f.standT, 1.6) * s * 0.05;
      var fy = y + bob + dip;
      // Every floe is its own shape, so a row of them never reads as
      // one long object.
      var fw = s * (0.34 + f.seed * 0.10);
      var fx2 = x + (f.seed - 0.5) * s * 0.12;

      ctx.fillStyle = 'rgba(8,20,40,0.22)';
      U.ellipse(ctx, fx2 - s * 0.05, fy + s * 0.10, fw * 0.95, s * 0.12);
      ctx.fill();

      ctx.fillStyle = f.state === 'cracking' ? '#ddeaf2'
        : U.mixHex('#eef6fa', '#cfe0ea', f.seed * 0.7);
      U.roundRect(ctx, fx2 - fw, fy - s * 0.16, fw * 2, s * (0.30 + f.seed * 0.07), s * (0.09 + f.seed * 0.06));
      ctx.fill();
      ctx.fillStyle = 'rgba(160,200,220,0.5)';
      U.roundRect(ctx, fx2 - fw, fy + s * 0.08, fw * 2, s * 0.08, s * 0.04);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,240,214,0.35)';
      U.roundRect(ctx, fx2 - fw * 0.8, fy - s * 0.155, fw, s * 0.05, s * 0.025);
      ctx.fill();


      if (f.state === 'cracking' || f.standT > 0.5) {
        // Cracks spider out from wherever the weight is.
        var severity = U.clamp((f.standT - 0.5) / 1.1, 0, 1);
        ctx.strokeStyle = 'rgba(70,110,140,' + (0.4 + severity * 0.5).toFixed(2) + ')';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (var cr = 0; cr < 3 + severity * 2; cr++) {
          var a2 = f.seed * 7 + cr * 2.2;
          var len2 = s * (0.12 + severity * 0.28) * (0.7 + hash(row.index, cr + (+key)) * 0.6);
          ctx.moveTo(fx2, fy);
          ctx.lineTo(fx2 + Math.cos(a2) * len2, fy + Math.sin(a2) * len2 * 0.45);
        }
        ctx.stroke();
      }
    }
  }

  /* A squad of marchers crossing the parade route like a slow vehicle. */
  function drawSquad(row, car, cam, t) {
    var x = sx(PP.World.carX(row, car), cam);
    var y = sy(row.index, cam) + view.rowH * 0.26;
    var s = view.tile;
    var w = car.w * s;
    if (x < -w || x > view.w + w) return;

    ctx.save();
    ctx.fillStyle = 'rgba(40,24,58,0.28)';
    U.ellipse(ctx, x, y, w * 0.5, s * 0.12);
    ctx.fill();

    var n = Math.max(3, Math.round(car.w / 0.75));
    var facing = row.dir > 0 ? 'right' : 'left';
    for (var k = 0; k < n; k++) {
      var mx = x + (k - (n - 1) / 2) * (w / n);
      var beat = t * 2.6 + car.seed * 5 + k * 0.5;
      var frac = beat - Math.floor(beat);
      var bounce = Math.sin(Math.min(frac * 1.6, 1) * Math.PI) * s * 0.08;
      CH.draw(ctx, mx, y - bounce, {
        size: s * 0.72, char: CH.enemySkin(car.skin + k), facing: facing,
        cap: (car.skin + k) % 3 === 0 ? 'ushanka' : 'cap'
      });
    }
    // The squad's little banner, carried at the front.
    var bx = x + row.dir * (w / 2 - s * 0.1);
    ctx.fillStyle = '#5e5248';
    ctx.fillRect(bx - s * 0.025, y - s * 1.3, s * 0.05, s * 1.0);
    ctx.fillStyle = '#c8102e';
    var wv = Math.sin(t * 4 + car.seed * 9) * s * 0.04;
    ctx.beginPath();
    ctx.moveTo(bx + s * 0.02, y - s * 1.28);
    ctx.lineTo(bx + s * 0.42 + wv, y - s * 1.23);
    ctx.lineTo(bx + s * 0.42 + wv, y - s * 0.95);
    ctx.lineTo(bx + s * 0.02, y - s * 1.0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /* The record line: how far you got last time, drawn where it happened. */
  function drawBestLine(rowIndex, cam) {
    var yTop = sy(rowIndex, cam) - view.rowH / 2;
    var s = view.tile;
    var lx0 = Math.max(0, sx(PP.World.CFG.X_MIN - 0.5, cam));
    var lx1 = Math.min(view.w, sx(PP.World.CFG.X_MAX + 0.5, cam));
    ctx.save();
    ctx.strokeStyle = 'rgba(245,197,66,0.7)';
    ctx.lineWidth = Math.max(2, s * 0.05);
    ctx.setLineDash([s * 0.3, s * 0.22]);
    ctx.beginPath();
    ctx.moveTo(lx0, yTop);
    ctx.lineTo(lx1, yTop);
    ctx.stroke();
    ctx.setLineDash([]);
    // A little tag on the right end.
    ctx.fillStyle = 'rgba(245,197,66,0.9)';
    U.roundRect(ctx, lx1 - s * 1.7, yTop - s * 0.26, s * 1.5, s * 0.5, s * 0.1);
    ctx.fill();
    ctx.fillStyle = '#3a2a10';
    ctx.font = '800 ' + Math.round(s * 0.3) + 'px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('BEST ' + rowIndex, lx1 - s * 0.95, yTop + s * 0.09);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  /* ── Sector borders ─────────────────────────────────────────────── */

  function drawCheckpoint(row, cam, t) {
    var s = view.tile;
    var y = sy(row.index, cam) + view.rowH * 0.28;
    var wallH = s * 1.05;
    var lo = PP.World.CFG.X_MIN - 6, hi = PP.World.CFG.X_MAX + 6;

    for (var x = lo; x <= hi; x++) {
      if (Math.abs(x - row.gateX) <= 1) continue;
      var px = sx(x, cam);
      if (px < -s || px > view.w + s) continue;
      // Concrete panel with a sunlit cap and seams.
      ctx.fillStyle = '#8a8177';
      ctx.fillRect(px - s * 0.5, y - wallH, s * 1.01, wallH);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(px + s * 0.46, y - wallH, s * 0.04, wallH);
      ctx.fillStyle = 'rgba(255,214,150,0.28)';
      ctx.fillRect(px - s * 0.5, y - wallH, s * 1.01, s * 0.06);
      if (hash(row.index, x) < 0.3) {
        ctx.strokeStyle = 'rgba(0,0,0,0.15)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(px - s * 0.2, y - wallH * (0.3 + hash(row.index, x + 50) * 0.4));
        ctx.lineTo(px + s * 0.1, y - wallH * (0.1 + hash(row.index, x + 90) * 0.3));
        ctx.stroke();
      }
      // Barbed wire along the top.
      ctx.strokeStyle = '#3f3a34';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px - s * 0.5, y - wallH - s * 0.08);
      ctx.quadraticCurveTo(px, y - wallH - s * 0.16, px + s * 0.51, y - wallH - s * 0.08);
      ctx.stroke();
      for (var bb = 0; bb < 3; bb++) {
        var bx4 = px - s * 0.3 + bb * s * 0.3;
        ctx.beginPath();
        ctx.moveTo(bx4 - 2.5, y - wallH - s * 0.14);
        ctx.lineTo(bx4 + 2.5, y - wallH - s * 0.08);
        ctx.moveTo(bx4 + 2.5, y - wallH - s * 0.14);
        ctx.lineTo(bx4 - 2.5, y - wallH - s * 0.08);
        ctx.stroke();
      }
    }

    // The gate: striped posts and a barrier arm swung up — you may pass.
    var gx = sx(row.gateX, cam);
    [-1.5, 1.5].forEach(function (side) {
      var px2 = gx + side * s;
      ctx.fillStyle = '#c8c0b4';
      ctx.fillRect(px2 - s * 0.06, y - s * 0.85, s * 0.12, s * 0.85);
      for (var st4 = 0; st4 < 3; st4++) {
        ctx.fillStyle = st4 % 2 ? '#f0e6d6' : '#c8102e';
        ctx.fillRect(px2 - s * 0.06, y - s * 0.85 + st4 * s * 0.28, s * 0.12, s * 0.28);
      }
    });
    ctx.save();
    ctx.translate(gx - s * 1.5, y - s * 0.8);
    ctx.rotate(-1.15);
    var seg5 = s * 1.4 / 4;
    for (var a5 = 0; a5 < 4; a5++) {
      ctx.fillStyle = a5 % 2 ? '#f0e6d6' : '#c8102e';
      ctx.fillRect(a5 * seg5, -s * 0.04, seg5 + 0.5, s * 0.08);
    }
    ctx.restore();

    // Watchtower beside the gate, with a sweeping searchlight.
    var tx2 = gx + s * 2.6;
    ctx.fillStyle = '#5f574c';
    ctx.fillRect(tx2 - s * 0.08, y - s * 1.7, s * 0.16, s * 1.7);
    ctx.fillRect(tx2 - s * 0.34, y - s * 2.1, s * 0.68, s * 0.5);
    ctx.fillStyle = '#4a443c';
    ctx.fillRect(tx2 - s * 0.4, y - s * 2.18, s * 0.8, s * 0.1);
    ctx.fillStyle = 'rgba(255,232,180,0.8)';
    ctx.fillRect(tx2 - s * 0.24, y - s * 2.0, s * 0.48, s * 0.24);
    ctx.fillStyle = '#c8102e';
    CH.star(ctx, tx2, y - s * 2.28, s * 0.12);

    var ang5 = Math.sin(t * 0.5 + row.index) * 0.55;
    ctx.save();
    ctx.translate(tx2, y - s * 1.9);
    ctx.rotate(ang5);
    ctx.globalCompositeOperation = 'lighter';
    var bg5 = ctx.createLinearGradient(0, 0, 0, s * 3.2);
    bg5.addColorStop(0, 'rgba(255,240,190,0.16)');
    bg5.addColorStop(1, 'rgba(255,240,190,0)');
    ctx.fillStyle = bg5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-s * 0.7, s * 3.2);
    ctx.lineTo(s * 0.7, s * 3.2);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  /* ── The black car ─────────────────────────────────────────────── */

  function drawVanCar(x, y, s, dir, dust, t) {
    ctx.save();
    ctx.fillStyle = 'rgba(40,24,58,0.32)';
    U.ellipse(ctx, x, y, s * 1.1, s * 0.14);
    ctx.fill();
    ctx.translate(x, y);
    ctx.scale(dir, 1);

    var w = s * 2.3;
    var bodyH = s * 0.42;
    var base = -s * 0.06;

    // Dust kicked up behind it — it is not using the road.
    if (dust > 0.01) {
      ctx.fillStyle = '#9a8a7a';
      for (var k = 0; k < 4; k++) {
        var ph = U.mod(t * 1.6 + k / 4, 1);
        ctx.globalAlpha = (1 - ph) * 0.35 * dust;
        U.ellipse(ctx, -w * 0.52 - ph * s * 0.9, base - s * 0.1 - ph * s * 0.3,
          s * (0.08 + ph * 0.22), s * (0.07 + ph * 0.16));
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Wheels.
    ctx.fillStyle = '#101014';
    [-w * 0.32, w * 0.32].forEach(function (wx) {
      U.ellipse(ctx, wx, base, s * 0.12, s * 0.12);
      ctx.fill();
    });

    // Long black body, official and unhurried about being seen.
    ctx.fillStyle = '#17171d';
    U.roundRect(ctx, -w / 2, base - bodyH * 0.8, w, bodyH * 0.8, s * 0.08);
    ctx.fill();
    ctx.fillStyle = '#22222b';
    U.roundRect(ctx, -w * 0.30, base - bodyH * 1.3, w * 0.60, bodyH * 0.58, s * 0.07);
    ctx.fill();
    // Curtained windows — nobody looks out, nobody looks in.
    ctx.fillStyle = 'rgba(70,70,86,0.9)';
    U.roundRect(ctx, -w * 0.24, base - bodyH * 1.2, w * 0.2, bodyH * 0.4, s * 0.03);
    ctx.fill();
    U.roundRect(ctx, w * 0.02, base - bodyH * 1.2, w * 0.2, bodyH * 0.4, s * 0.03);
    ctx.fill();
    // Roof light, sweeping.
    var lampOn = Math.sin(t * 14) > 0;
    ctx.fillStyle = lampOn ? '#ff4b3a' : '#7c1d16';
    U.ellipse(ctx, 0, base - bodyH * 1.36, s * 0.07, s * 0.07);
    ctx.fill();
    if (lampOn) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,70,50,0.25)';
      U.ellipse(ctx, 0, base - bodyH * 1.36, s * 0.3, s * 0.2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    // Fender flag + star.
    ctx.fillStyle = '#c8102e';
    ctx.fillRect(w * 0.40, base - bodyH * 1.05, s * 0.03, s * 0.2);
    ctx.beginPath();
    ctx.moveTo(w * 0.40 + s * 0.03, base - bodyH * 1.05);
    ctx.lineTo(w * 0.40 + s * 0.2, base - bodyH * 1.0);
    ctx.lineTo(w * 0.40 + s * 0.03, base - bodyH * 0.94);
    ctx.closePath();
    ctx.fill();
    CH.star(ctx, -w * 0.36, base - bodyH * 0.42, s * 0.1);
    // Sun on the roof — even this car obeys the light.
    ctx.fillStyle = 'rgba(255,214,150,0.2)';
    ctx.fillRect(-w * 0.28, base - bodyH * 1.3 - 1.5, w * 0.56, 2.5);

    headBeam(w * 0.5, base - s * 0.16, s);
    ctx.restore();
  }

  function drawVan(v, g, cam, t) {
    var s = view.tile;
    var tx = sx(v.x, cam);
    var ty = sy(v.row, cam) + view.rowH * 0.26;
    var dir = -v.fromSide;                    // direction of travel
    var edgeX = view.w / 2 + v.fromSide * (view.w / 2 + s * 3);

    if (v.state === 'warn') {
      // The locked tile, ringed — and headlights already at the kerb.
      var k = U.clamp(v.t / 0.9, 0, 1);
      var blink3 = Math.sin(t * 16) > 0;
      ctx.save();
      ctx.globalAlpha = (0.65 + k * 0.35) * (blink3 ? 1 : 0.45);
      ctx.strokeStyle = '#ff4b3a';
      ctx.lineWidth = Math.max(2.5, s * 0.06);
      U.ellipse(ctx, tx, ty - view.rowH * 0.06, s * (0.32 + k * 0.42), s * (0.13 + k * 0.17));
      ctx.stroke();
      ctx.strokeStyle = '#f5c542';
      ctx.lineWidth = Math.max(1.5, s * 0.03);
      U.ellipse(ctx, tx, ty - view.rowH * 0.06, s * (0.16 + k * 0.2), s * (0.07 + k * 0.08));
      ctx.stroke();
      ctx.restore();
      // A glow building at the screen edge on this row.
      ctx.globalCompositeOperation = 'lighter';
      var eg = ctx.createLinearGradient(edgeX, 0, edgeX + dir * s * 4, 0);
      eg.addColorStop(0, 'rgba(255,200,120,' + (0.20 * k).toFixed(3) + ')');
      eg.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = eg;
      ctx.fillRect(Math.min(edgeX, edgeX + dir * s * 4), ty - s * 0.8, s * 4, s * 1.2);
      ctx.globalCompositeOperation = 'source-over';
    } else if (v.state === 'arrive') {
      var k2 = U.clamp(v.t / 0.45, 0, 1);
      var e2 = 1 - Math.pow(1 - k2, 3);
      var vx2 = U.lerp(edgeX, tx, e2);
      // Skid marks behind it.
      ctx.strokeStyle = 'rgba(20,16,24,0.35)';
      ctx.lineWidth = Math.max(2, s * 0.06);
      [-1, 1].forEach(function (sgn) {
        ctx.beginPath();
        ctx.moveTo(vx2 - dir * s * 1.4, ty + sgn * s * 0.1);
        ctx.lineTo(edgeX, ty + sgn * s * 0.1);
        ctx.stroke();
      });
      drawVanCar(vx2, ty, s, dir, 1, t);
    } else if (v.state === 'grab') {
      drawVanCar(tx, ty, s, dir, 0.15, t);
      if (v.caught) {
        // The rear door stands open exactly as long as it needs to.
        ctx.fillStyle = '#101014';
        ctx.fillRect(tx - dir * s * 0.15, ty - s * 0.62, dir * s * 0.34, s * 0.5);
        ctx.fillStyle = 'rgba(70,70,86,0.9)';
        ctx.fillRect(tx - dir * s * 0.11, ty - s * 0.56, dir * s * 0.2, s * 0.18);
      }
    } else if (v.state === 'depart') {
      var k3 = U.clamp(v.t / 1.0, 0, 1);
      var e3 = k3 * k3;
      var vx3 = tx + dir * e3 * (view.w * 0.7 + s * 6);
      drawVanCar(vx3, ty, s, dir, 1, t);
    }
  }

  /* ── The Collective ─────────────────────────────────────────────── */

  function drawTideBand(row, cam, tideRow, t) {
    var d = tideRow - row.index;      // how deeply this row is swallowed
    if (d < 0) return;
    var top = sy(row.index, cam) - view.rowH / 2;
    var a = U.clamp(0.36 + d * 0.075 + 0.03 * Math.sin(t * 2.2 + row.index * 0.6)
      + (hash(row.index, 9) - 0.5) * 0.06, 0, 0.62);
    ctx.fillStyle = 'rgba(146,8,26,' + a.toFixed(3) + ')';
    ctx.fillRect(0, top, view.w, view.rowH + 1);
    if (d < 3) {
      ctx.fillStyle = 'rgba(255,90,70,' + (0.16 * (3 - d) / 3).toFixed(3) + ')';
      ctx.fillRect(0, top, view.w, view.rowH + 1);
    }
    if (d < 2.5) {
      // What got dropped in the scramble to get away.
      var s2 = view.tile;
      ctx.fillStyle = 'rgba(45,0,12,0.55)';
      for (var db = 0; db < 2; db++) {
        var hx2 = hash(row.index * 5 + db, 77);
        var dx2 = hx2 * view.w;
        var dy2 = top + view.rowH * (0.3 + hash(row.index, db + 31) * 0.4);
        var kind2 = (hx2 * 7 | 0) % 3;
        if (kind2 === 0) {          // a tipped food bowl
          ctx.fillRect(dx2 - s2 * 0.10, dy2 - s2 * 0.08, s2 * 0.2, s2 * 0.07);
          U.ellipse(ctx, dx2, dy2, s2 * 0.13, s2 * 0.05);
          ctx.fill();
        } else if (kind2 === 1) {   // a ball nobody will throw again
          U.ellipse(ctx, dx2, dy2, s2 * 0.07, s2 * 0.07);
          ctx.fill();
        } else {                    // a dropped leash
          ctx.strokeStyle = 'rgba(45,0,12,0.55)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(dx2, dy2, s2 * 0.12, 0.4, 2.6);
          ctx.stroke();
          U.ellipse(ctx, dx2 + s2 * 0.12, dy2 + s2 * 0.03, s2 * 0.035, s2 * 0.035);
          ctx.fill();
        }
      }
    }
  }

  function drawTideFront(cam, tideRow, t) {
    var s = view.tile;
    var y = sy(tideRow, cam) + view.rowH * 0.26;

    // Searchlights raking the sky from behind the front line. They only
    // reach full strength once their implied source nears the screen.
    var beamVis = U.clamp(1 - (y - view.h) / (view.rowH * 2), 0, 1);
    ctx.globalCompositeOperation = 'lighter';
    for (var b = 0; b < 2; b++) {
      var ang = Math.sin(t * (0.4 + b * 0.13) + b * 2.1) * 0.5;
      var bx = view.w * (0.25 + b * 0.5);
      var L = view.h * 0.55;
      ctx.save();
      ctx.translate(bx, y - s * 0.4);
      ctx.rotate(ang);
      // Two nested wedges fake a soft cross-beam falloff.
      for (var nb = 0; nb < 2; nb++) {
        var wA = nb === 0 ? 0.75 : 0.35;
        var bg = ctx.createLinearGradient(0, 0, 0, -L);
        bg.addColorStop(0, 'rgba(255,90,80,' + ((nb === 0 ? 0.030 : 0.045) * beamVis).toFixed(3) + ')');
        bg.addColorStop(1, 'rgba(255,90,80,0)');
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-s * wA * 0.8, -L);
        ctx.lineTo(s * wA, -L);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';

    // Smoke and red glow rolling off the front line.
    var g = ctx.createLinearGradient(0, y - s * 1.8, 0, y + s * 0.6);
    g.addColorStop(0, 'rgba(180,20,35,0)');
    g.addColorStop(1, 'rgba(150,10,26,0.6)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y - s * 1.8, view.w, s * 2.4);

    // And its firelight spills ahead of the marchers, flickering.
    var spill = ctx.createLinearGradient(0, y - view.rowH * 2.2, 0, y - s * 0.4);
    spill.addColorStop(0, 'rgba(255,80,40,0)');
    spill.addColorStop(1, 'rgba(255,80,40,' + (0.06 + 0.02 * Math.sin(t * 7)).toFixed(3) + ')');
    ctx.fillStyle = spill;
    ctx.fillRect(0, y - view.rowH * 2.2, view.w, view.rowH * 2.2 - s * 0.4);

    // A rank of marchers with banners, stepping in time.
    var spacing = s * 0.92;
    var offset = U.mod(-cam.x * view.tile, spacing);
    var idx = 0;
    // If the bearers are below the bottom edge, their flags and placards
    // must not poke into the frame on disembodied poles.
    var propsVisible = y - s * 0.85 <= view.h;
    for (var px = offset - spacing; px < view.w + spacing; px += spacing, idx++) {
      // The whole rank stomps on a shared beat, half the line offset by
      // half a step — a parade, not a crowd.
      var beat = t * 2.4 + (idx % 2) * 0.5;
      var frac = beat - Math.floor(beat);
      var bounce = Math.sin(Math.min(frac * 1.6, 1) * Math.PI) * s * 0.10;
      var skin = CH.enemySkin(idx);
      if (idx % 4 === 1 && propsVisible) {
        ctx.fillStyle = '#5e5248';
        ctx.fillRect(px + s * 0.22, y - s * 1.5 - bounce, s * 0.05, s * 1.1);
        ctx.fillStyle = '#c8102e';
        var wave = Math.sin(t * 4 + idx) * s * 0.05;
        ctx.beginPath();
        ctx.moveTo(px + s * 0.26, y - s * 1.48 - bounce);
        ctx.lineTo(px + s * 0.74 + wave, y - s * 1.42 - bounce);
        ctx.lineTo(px + s * 0.74 + wave, y - s * 1.06 - bounce);
        ctx.lineTo(px + s * 0.26, y - s * 1.12 - bounce);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#f5c542';
        CH.star(ctx, px + s * 0.50 + wave * 0.5, y - s * 1.27 - bounce, s * 0.09);
      }
      if (idx % 8 === 6 && propsVisible) {
        // A framed portrait of the Very Important Animal, held at rank
        // height in a dull brass frame — official, not collectible.
        var py2 = y - bounce;
        ctx.fillStyle = '#5e5248';
        ctx.fillRect(px + s * 0.20, py2 - s * 0.88, s * 0.05, s * 0.55);
        ctx.fillStyle = '#b8923a';
        U.roundRect(ctx, px + s * 0.02, py2 - s * 1.34, s * 0.42, s * 0.5, s * 0.04);
        ctx.fill();
        ctx.fillStyle = '#c8102e';
        ctx.fillRect(px + s * 0.06, py2 - s * 1.30, s * 0.34, s * 0.42);
        ctx.fillStyle = '#3a1a26';
        U.ellipse(ctx, px + s * 0.23, py2 - s * 1.02, s * 0.10, s * 0.09);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(px + s * 0.15, py2 - s * 1.07);
        ctx.lineTo(px + s * 0.185, py2 - s * 1.18);
        ctx.lineTo(px + s * 0.22, py2 - s * 1.07);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(px + s * 0.24, py2 - s * 1.07);
        ctx.lineTo(px + s * 0.275, py2 - s * 1.18);
        ctx.lineTo(px + s * 0.31, py2 - s * 1.07);
        ctx.closePath();
        ctx.fill();
      }
      CH.draw(ctx, px, y - bounce, {
        size: s * 0.78, char: skin, facing: 'up',
        cap: idx % 3 === 0 ? 'ushanka' : 'cap', alpha: 0.95
      });
    }

    // Embers lifting off the tide.
    ctx.globalCompositeOperation = 'lighter';
    for (var e = 0; e < 16; e++) {
      var eph = U.mod(t * 0.35 + hash(e, 17), 1);
      var ex = hash(e, 301) * view.w + Math.sin(t * 1.2 + e) * 9;
      var ey = y + s * 0.3 - eph * s * 2.8;
      var flick = 0.5 + 0.5 * Math.sin(t * 7 + e * 2.3);
      ctx.globalAlpha = (1 - eph) * 0.5 * flick;
      ctx.fillStyle = e % 3 === 0 ? '#ffb26b' : '#ff5f4d';
      U.ellipse(ctx, ex, ey, 1.6 + hash(e, 5) * 1.6, 1.6 + hash(e, 5) * 1.6);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ── Player + effects ───────────────────────────────────────────── */

  function drawPlayer(p, cam, char, t, fear, hot) {
    if (p.dead && p.deathKind === 'water' && p.sinkT > 0.9) return;
    var x = sx(p.x, cam);
    var y = sy(p.row, cam) + view.rowH * 0.24;
    var s = view.tile;

    var rowObj = PP.World.row(Math.round(p.row));
    var onWaterRow = rowObj && rowObj.type === 'water';
    if (!p.dead && !onWaterRow) longShadow(x, y, s * 0.85, s * 0.24, 0.16);

    // The tide's firelight reaches the escapee before the tide does.
    if (fear > 0.03 && !p.dead) {
      ctx.fillStyle = 'rgba(255,60,40,' + (0.14 * fear).toFixed(3) + ')';
      U.ellipse(ctx, x, y, s * 0.8, s * 0.3);
      ctx.fill();
    }

    var opts = {
      size: s * 1.02, char: char, facing: p.facing,
      squash: p.squash, lift: p.lift * s, alpha: 1,
      fear: p.dead ? 0 : (fear || 0)
    };
    if (!p.hopping && !p.dead) {
      opts.squash += Math.sin(t * 2.8) * 0.02;   // breathing
      // Press-and-hold: crouched, coiled, ready.
      if (p.charging) opts.squash = Math.max(opts.squash, 0.30);
    }
    if (p.dead) {
      if (p.deathKind === 'squash') {
        opts.squash = 0.85;
        opts.lift = 0;
      } else if (p.deathKind === 'water') {
        opts.alpha = 1 - p.sinkT;
        opts.lift = -p.sinkT * s * 0.35;
      } else if (p.deathKind === 'van') {
        // Hustled into the back seat: a quick fade, no theatrics.
        opts.alpha = Math.max(0, 1 - p.sinkT * 1.4);
        opts.squash = 0.15;
      } else if (p.deathKind === 'caught') {
        // Hat drops on, then you start marching in time with the rest.
        opts.cap = 'ushanka';
        opts.capT = U.clamp((p.convertT - 0.25) / 0.45, 0, 1);
        opts.lift = p.convertT > 0.6 ? Math.abs(Math.sin(p.marchT * 5)) * s * 0.10 : 0;
      }
    }
    CH.draw(ctx, x, y, opts);

    // Momentum: motion streaks trailing a hot streak.
    if (hot && !p.dead) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(255,220,150,0.35)';
      ctx.lineWidth = Math.max(1.5, s * 0.04);
      [-0.3, 0.3].forEach(function (off) {
        ctx.beginPath();
        ctx.moveTo(x + off * s, y + s * 0.1);
        ctx.lineTo(x + off * s * 1.4, y + s * 0.66);
        ctx.stroke();
      });
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    }

    // The moment it takes: a red star rises over the new comrade.
    if (p.dead && p.deathKind === 'caught' && p.convertT > 0.5) {
      var st = U.clamp((p.convertT - 0.5) / 0.4, 0, 1);
      ctx.save();
      ctx.globalAlpha = st;
      ctx.fillStyle = '#c8102e';
      CH.star(ctx, x, y - s * (1.15 + st * 0.25), s * 0.19 * st);
      ctx.restore();
    }
  }

  function drawSplashes(list, cam) {
    for (var i = 0; i < list.length; i++) {
      var sp = list[i];
      var k = sp.t / sp.maxT;
      var x = sx(sp.x, cam);
      var y = sy(sp.row, cam) + view.rowH * 0.18;
      var s = view.tile;
      ctx.save();

      if (sp.kind === 'dust' || sp.kind === 'ripple') {
        // A quick ring marks every landing.
        ctx.globalAlpha = (1 - k) * 0.55;
        ctx.strokeStyle = sp.kind === 'dust' ? 'rgba(226,204,158,0.9)' : 'rgba(216,242,255,0.9)';
        ctx.lineWidth = Math.max(1.5, s * 0.05 * (1 - k));
        U.ellipse(ctx, x, y + view.rowH * 0.06, s * (0.16 + k * 0.42), s * (0.06 + k * 0.16));
        ctx.stroke();
        ctx.restore();
        continue;
      }

      ctx.lineWidth = Math.max(1.5, s * 0.055 * (1 - k));
      for (var r = 0; r < 3; r++) {
        var rk = k - r * 0.16;
        if (rk <= 0 || rk >= 1) continue;
        ctx.globalAlpha = (1 - rk) * 0.75;
        ctx.strokeStyle = r === 0 ? 'rgba(255,255,255,0.95)' : 'rgba(186,226,248,0.9)';
        U.ellipse(ctx, x, y, s * (0.18 + rk * 1.15), s * (0.07 + rk * 0.42));
        ctx.stroke();
      }
      // The column of water thrown up by the impact.
      if (k < 0.42) {
        var ck = k / 0.42;
        ctx.globalAlpha = (1 - ck) * 0.9;
        ctx.fillStyle = 'rgba(226,244,255,0.95)';
        U.ellipse(ctx, x, y - s * 0.30 * Math.sin(ck * Math.PI),
          s * (0.20 - ck * 0.08), s * (0.34 + ck * 0.22));
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawParticles(list, cam) {
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var x = sx(p.x, cam);
      var y = sy(p.row, cam) + view.rowH * 0.2 - p.z * view.tile;
      ctx.globalAlpha = U.clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      var sz = p.size * view.tile;
      if (p.shape === 'circle') {
        U.ellipse(ctx, x, y, sz, sz);
        ctx.fill();
      } else {
        ctx.fillRect(x - sz, y - sz, sz * 2, sz * 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawFloaters(list, cam) {
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      ctx.globalAlpha = U.clamp(f.life / f.maxLife, 0, 1);
      ctx.fillStyle = f.color || '#f5c542';
      ctx.font = '800 ' + Math.round(view.tile * 0.42) + 'px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 3;
      var x = sx(f.x, cam);
      var y = sy(f.row, cam) - (1 - f.life / f.maxLife) * view.tile * 0.9;
      ctx.strokeText(f.text, x, y);
      ctx.fillText(f.text, x, y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  /* The further you flee, the colder it gets: snow begins around 35m,
     right where the rivers start freezing. Stateless — every flake's
     position is a function of time. */
  function drawSnow(cam, t) {
    var intensity = U.clamp((cam.row - 35) / 40, 0, 0.85);
    if (intensity <= 0.01) return;
    var n = Math.floor(46 * intensity);
    ctx.fillStyle = '#f2f6fa';
    for (var i = 0; i < n; i++) {
      var speed = 26 + hash(i, 401) * 34;
      var drift = Math.sin(t * (0.6 + hash(i, 403)) + i * 2.1) * 30;
      var fx = U.mod(hash(i, 405) * view.w + drift - cam.x * view.tile * 0.15, view.w + 20) - 10;
      var fy = U.mod(hash(i, 407) * view.h + t * speed + cam.row * 8, view.h + 16) - 8;
      ctx.globalAlpha = 0.35 + hash(i, 409) * 0.4;
      var fs = 1.4 + hash(i, 411) * 1.6;
      ctx.fillRect(fx, fy, fs, fs);
    }
    ctx.globalAlpha = 1;
  }

  /* Dusk grade: warm above, cool below, dark in the corners. */
  function drawGrade() {
    var lg = ctx.createLinearGradient(0, 0, 0, view.h);
    lg.addColorStop(0, 'rgba(255,166,86,0.055)');
    lg.addColorStop(0.5, 'rgba(0,0,0,0)');
    lg.addColorStop(1, 'rgba(22,12,48,0.17)');
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, view.w, view.h);

    var rv = ctx.createRadialGradient(
      view.w / 2, view.h * 0.52, Math.min(view.w, view.h) * 0.45,
      view.w / 2, view.h * 0.52, Math.max(view.w, view.h) * 0.78
    );
    rv.addColorStop(0, 'rgba(8,5,16,0)');
    rv.addColorStop(1, 'rgba(8,5,16,0.22)');
    ctx.fillStyle = rv;
    ctx.fillRect(0, 0, view.w, view.h);
  }

  function drawVignette(g) {
    var danger = g.showPlayer ? U.clamp(1 - (g.player.row - g.tide.row) / 9, 0, 1) : 0;
    if (danger > 0.02) {
      var rg = ctx.createRadialGradient(
        view.w / 2, view.h * 0.55, view.h * 0.25,
        view.w / 2, view.h * 0.55, view.h * 0.85
      );
      rg.addColorStop(0, 'rgba(200,16,46,0)');
      rg.addColorStop(1, 'rgba(200,16,46,' + (0.55 * danger).toFixed(3) + ')');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, view.w, view.h);
    }
    if (g.flash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + (g.flash * 0.6).toFixed(3) + ')';
      ctx.fillRect(0, 0, view.w, view.h);
    }
  }

  /* ── Frame ──────────────────────────────────────────────────────── */

  function draw(g) {
    var cam = g.cam;
    var t = PP.World.time();
    if (!patterns.asphalt) buildPatterns();

    ctx.save();
    if (g.shake > 0.001) {
      ctx.translate((Math.random() - 0.5) * g.shake * 18, (Math.random() - 0.5) * g.shake * 18);
    }

    // How far ahead we can see. The skyline is planted exactly on that edge
    // so the ground and the city meet without a seam.
    var depth = U.clamp((view.baseY - view.h * 0.17) / view.rowH, 6, 16);
    var farRow = Math.floor(cam.row + depth);
    var nearRow = Math.floor(cam.row - (view.h - view.baseY) / view.rowH) - 1;
    // A constant screen position: the world slides beneath the skyline
    // instead of the skyline re-seating itself on every row crossed.
    horizonY = view.baseY - (depth - 0.5) * view.rowH;

    drawSky(cam, t);

    var playerDrawRow = Math.round(g.player.row);
    // How scared should the body language be? Purely a function of the gap.
    var fear = g.showPlayer && !g.player.dead
      ? U.clamp(1 - (g.player.row - g.tide.row) / 4.5, 0, 1) : 0;

    for (var i = farRow; i >= nearRow; i--) {
      // Rows behind the start line don't exist; the tide is already there,
      // but draw plain ground so the screen never shows a hole.
      var row = i < 0 ? { index: i, type: 'grass', decor: [], blocked: {}, coin: null } : PP.World.row(i);
      if (!row) continue;

      drawBand(row, cam, t);

      if (row.type === 'grass') {
        if (row.fence) drawFence(row, cam);
        for (var d = 0; d < row.decor.length; d++) drawDecor(row, row.decor[d], cam, t);
        drawCoin(row, cam, t);
      } else if (row.type === 'road') {
        for (var c = 0; c < row.cars.length; c++) drawCar(row, row.cars[c], cam, t);
      } else if (row.type === 'water') {
        for (var l = 0; l < row.logs.length; l++) drawLog(row, row.logs[l], cam, t);
      } else if (row.type === 'ice') {
        drawFloes(row, cam, t);
      } else if (row.type === 'parade') {
        for (var q = 0; q < row.cars.length; q++) drawSquad(row, row.cars[q], cam, t);
      } else if (row.type === 'checkpoint') {
        drawCheckpoint(row, cam, t);
      } else if (row.type === 'rail') {
        if (row.state === 'train') drawTrain(row, cam, t);
        drawRailSignals(row, cam, t);
      }

      if (g.bestLineRow >= 3 && i === g.bestLineRow && g.showPlayer) drawBestLine(i, cam);

      // Aerial perspective: far rows sink into the warm smog, near rows
      // cool toward the night behind you. Painted over the row's own
      // sprites so terrain and traffic recede together; the player is
      // drawn after this and stays vivid.
      if (i > cam.row + 4) {
        var kFar = U.clamp((i - cam.row - 4) / (depth - 4), 0, 1);
        ctx.fillStyle = 'rgba(226,158,98,' + (kFar * kFar * 0.30).toFixed(3) + ')';
        ctx.fillRect(0, sy(i, cam) - view.rowH / 2, view.w, view.rowH + 1);
      } else if (i < cam.row - 1) {
        var kNear = U.clamp((cam.row - 1 - i) / 6, 0, 1);
        ctx.fillStyle = 'rgba(24,16,34,' + (kNear * 0.10).toFixed(3) + ')';
        ctx.fillRect(0, sy(i, cam) - view.rowH / 2, view.w, view.rowH + 1);
      }

      if (g.tide.row >= i) drawTideBand(row, cam, g.tide.row, t);
      if (Math.floor(g.tide.row) === i) drawTideFront(cam, g.tide.row, t);

      if (i === playerDrawRow && g.showPlayer) drawPlayer(g.player, cam, g.playerChar || g.char, t, fear, g.streak >= 10);
    }

    if (g.van && g.van.state !== 'idle' && g.showPlayer) drawVan(g.van, g, cam, t);

    // The last of the sun finds the escapee.
    if (g.showPlayer && !g.player.dead) {
      var pxS = sx(g.player.x, cam);
      var pyS = sy(g.player.row, cam);
      var pr = view.tile * 2.4;
      ctx.globalCompositeOperation = 'lighter';
      var pocket = ctx.createRadialGradient(pxS, pyS, 0, pxS, pyS, pr);
      pocket.addColorStop(0, 'rgba(255,214,150,0.08)');
      pocket.addColorStop(1, 'rgba(255,214,150,0)');
      ctx.fillStyle = pocket;
      U.ellipse(ctx, pxS, pyS, pr, pr);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    drawSplashes(g.splashes, cam);

    // Distance haze: the far rows dissolve into the smog.
    var hzY = horizonY;
    var hz = ctx.createLinearGradient(0, hzY - view.rowH * 1.1, 0, hzY + view.rowH * 1.9);
    hz.addColorStop(0, 'rgba(205,124,82,0.55)');
    hz.addColorStop(1, 'rgba(205,124,82,0)');
    ctx.fillStyle = hz;
    ctx.fillRect(0, hzY - view.rowH * 1.1, view.w, view.rowH * 3.0);

    // Out of bounds: everything past the walkable columns falls into shadow,
    // so a wide screen still reads as a corridor you cannot leave.
    var bl = sx(PP.World.CFG.X_MIN - 2.0, cam);
    var br = sx(PP.World.CFG.X_MAX + 2.0, cam);
    if (bl > 0) {
      var lg2 = ctx.createLinearGradient(0, 0, bl, 0);
      lg2.addColorStop(0, 'rgba(10,6,20,0.38)');
      lg2.addColorStop(1, 'rgba(10,6,20,0)');
      ctx.fillStyle = lg2;
      ctx.fillRect(0, 0, bl, view.h);
    }
    if (br < view.w) {
      var rg2 = ctx.createLinearGradient(view.w, 0, br, 0);
      rg2.addColorStop(0, 'rgba(10,6,20,0.38)');
      rg2.addColorStop(1, 'rgba(10,6,20,0)');
      ctx.fillStyle = rg2;
      ctx.fillRect(br, 0, view.w - br, view.h);
    }

    drawParticles(g.particles, cam);
    drawFloaters(g.floaters, cam);
    drawSnow(cam, t);
    ctx.restore();

    drawGrade();
    drawVignette(g);
  }

  /* Small portrait used by the character-select cards. */
  function drawPortrait(cnv, char) {
    var c = cnv.getContext('2d');
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var size = 76;
    cnv.width = size * dpr;
    cnv.height = size * dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, size, size);
    CH.draw(c, size / 2, size * 0.92, { size: size * 0.82, char: char, facing: 'down' });
  }

  PP.Render = {
    view: view,
    init: function (cnv) {
      canvas = cnv;
      ctx = cnv.getContext('2d');
      resize();
      buildPatterns();
    },
    resize: resize,
    draw: draw,
    drawPortrait: drawPortrait,
    sx: sx,
    sy: sy
  };
})(window);
