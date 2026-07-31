/* All drawing. A faux-3D side-on view: the world is a stack of horizontal
   bands, near rows are lower on screen, everything is drawn far-to-near so
   tall scenery occludes correctly. */
(function (global) {
  'use strict';

  var PP = global.PP;
  var U = PP.U;
  var CH = PP.Characters;

  var canvas, ctx;
  var view = { w: 0, h: 0, dpr: 1, tile: 48, rowH: 42, baseY: 0 };

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

  /* ── Backdrop ───────────────────────────────────────────────────── */

  function drawSky(cam, t, horizon) {
    var g = ctx.createLinearGradient(0, 0, 0, horizon + 40);
    g.addColorStop(0, '#2b1d34');
    g.addColorStop(0.45, '#5d3a45');
    g.addColorStop(0.78, '#b9694d');
    g.addColorStop(1, '#e0a05e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.w, horizon + 42);

    // Sun, low and cold.
    var sunY = horizon - view.h * 0.075;
    var sunR = Math.min(view.h, view.w) * 0.055;
    ctx.fillStyle = 'rgba(255,214,150,0.24)';
    U.ellipse(ctx, view.w * 0.72, sunY, sunR * 1.7, sunR * 1.7);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,236,196,0.5)';
    U.ellipse(ctx, view.w * 0.72, sunY, sunR, sunR);
    ctx.fill();

    // A skyline of identical concrete blocks, parallax-scrolled.
    var off = U.mod(cam.x * view.tile * 0.25 + cam.row * 2, 120);
    ctx.fillStyle = 'rgba(38,28,44,0.75)';
    for (var i = -1; i < view.w / 120 + 2; i++) {
      var bx = i * 120 - off;
      var bh = 40 + ((i * 37) % 5) * 16;
      ctx.fillRect(bx, horizon - bh, 96, bh);
      ctx.fillStyle = 'rgba(255,190,120,0.10)';
      for (var wy = 0; wy < bh - 14; wy += 14) {
        for (var wx2 = 0; wx2 < 80; wx2 += 18) {
          if (((i * 7 + wy + wx2) % 5) < 2) ctx.fillRect(bx + 8 + wx2, horizon - bh + 8 + wy, 8, 7);
        }
      }
      ctx.fillStyle = 'rgba(38,28,44,0.75)';
    }
    // Haze where the ground meets the city.
    var hz = ctx.createLinearGradient(0, horizon - 30, 0, horizon + 60);
    hz.addColorStop(0, 'rgba(224,160,94,0)');
    hz.addColorStop(1, 'rgba(120,70,60,0.55)');
    ctx.fillStyle = hz;
    ctx.fillRect(0, horizon - 30, view.w, 90);
  }

  /* ── Terrain bands ──────────────────────────────────────────────── */

  function drawBand(row, cam, t) {
    var top = sy(row.index, cam) - view.rowH / 2;
    var h = view.rowH;
    var lip = h * 0.20;
    var x0 = 0, x1 = view.w;

    if (row.type === 'grass') {
      var even = row.index % 2 === 0;
      ctx.fillStyle = even ? '#5c9e46' : '#66aa4c';
      ctx.fillRect(x0, top, x1, h);
      ctx.fillStyle = 'rgba(0,0,0,0.13)';
      ctx.fillRect(x0, top + h - lip * 0.5, x1, lip * 0.5);
      // Sparse tufts.
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      for (var i = 0; i < 14; i++) {
        var gx = U.mod(i * 137 + row.index * 53, view.w);
        ctx.fillRect(gx, top + (i % 3) * h * 0.28 + h * 0.15, 5, 2);
      }
    } else if (row.type === 'road') {
      ctx.fillStyle = '#3a3742';
      ctx.fillRect(x0, top, x1, h);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x0, top, x1, h * 0.10);
      // Lane dashes.
      ctx.strokeStyle = 'rgba(240,225,200,0.35)';
      ctx.lineWidth = Math.max(2, view.tile * 0.05);
      ctx.setLineDash([view.tile * 0.42, view.tile * 0.42]);
      ctx.beginPath();
      ctx.moveTo(0, top + h / 2);
      ctx.lineTo(view.w, top + h / 2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (row.type === 'water') {
      var g = ctx.createLinearGradient(0, top, 0, top + h);
      g.addColorStop(0, '#1d4f7a');
      g.addColorStop(1, '#2a6f9e');
      ctx.fillStyle = g;
      ctx.fillRect(x0, top, x1, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 2;
      for (var k = 0; k < 7; k++) {
        var phase = t * (row.dir > 0 ? 26 : -26) + k * 90 + row.index * 31;
        var rx = U.mod(phase, view.w + 120) - 60;
        var ry = top + h * (0.25 + ((k * 3 + row.index) % 3) * 0.22);
        ctx.beginPath();
        ctx.arc(rx, ry + 6, 12, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.20)';
      ctx.fillRect(x0, top, x1, h * 0.09);
    } else if (row.type === 'rail') {
      ctx.fillStyle = '#6b6255';
      ctx.fillRect(x0, top, x1, h);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x0, top, x1, h * 0.10);
      // Sleepers.
      ctx.fillStyle = '#4b3f33';
      var step = view.tile * 0.55;
      for (var sxp = U.mod(-cam.x * view.tile, step) - step; sxp < view.w; sxp += step) {
        ctx.fillRect(sxp, top + h * 0.22, step * 0.42, h * 0.56);
      }
      // Rails.
      ctx.fillStyle = '#a9a29a';
      ctx.fillRect(x0, top + h * 0.30, x1, Math.max(2, h * 0.07));
      ctx.fillRect(x0, top + h * 0.63, x1, Math.max(2, h * 0.07));
    }
  }

  /* ── Scenery ────────────────────────────────────────────────────── */

  function drawDecor(row, d, cam) {
    var x = sx(d.x, cam);
    var y = sy(row.index, cam) + view.rowH * 0.22;
    var s = view.tile;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    U.ellipse(ctx, x, y, s * 0.34, s * 0.12);
    ctx.fill();

    if (d.kind === 'tree') {
      var th = s * d.h;
      ctx.fillStyle = '#5b3d26';
      ctx.fillRect(x - s * 0.09, y - th * 0.45, s * 0.18, th * 0.45);
      var lay = 3;
      for (var i = 0; i < lay; i++) {
        var f = i / (lay - 1);
        ctx.fillStyle = i === 0 ? '#2f6b34' : (i === 1 ? '#38803d' : '#43964a');
        U.ellipse(ctx, x, y - th * (0.42 + f * 0.42), s * (0.42 - f * 0.10), s * (0.28 - f * 0.06));
        ctx.fill();
      }
    } else if (d.kind === 'bush') {
      ctx.fillStyle = '#356f39';
      U.ellipse(ctx, x - s * 0.13, y - s * 0.14, s * 0.22, s * 0.18);
      ctx.fill();
      U.ellipse(ctx, x + s * 0.13, y - s * 0.16, s * 0.20, s * 0.17);
      ctx.fill();
      ctx.fillStyle = '#40853f';
      U.ellipse(ctx, x, y - s * 0.26, s * 0.26, s * 0.21);
      ctx.fill();
    } else if (d.kind === 'rock') {
      ctx.fillStyle = '#8d8a86';
      ctx.beginPath();
      ctx.moveTo(x - s * 0.30, y);
      ctx.lineTo(x - s * 0.20, y - s * 0.34);
      ctx.lineTo(x + s * 0.06, y - s * 0.42);
      ctx.lineTo(x + s * 0.30, y - s * 0.12);
      ctx.lineTo(x + s * 0.24, y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.moveTo(x - s * 0.20, y - s * 0.34);
      ctx.lineTo(x + s * 0.06, y - s * 0.42);
      ctx.lineTo(x - s * 0.02, y - s * 0.20);
      ctx.closePath();
      ctx.fill();
    } else if (d.kind === 'bust') {
      // A monument to a very important animal.
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
      ctx.fillStyle = '#c8102e';
      CH.star(ctx, x, y - s * 0.30, s * 0.11);
    } else if (d.kind === 'banner') {
      var wave = Math.sin(PP.World.time() * 3 + d.seed * 9) * s * 0.06;
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
      ctx.fillStyle = '#f5c542';
      CH.star(ctx, x + s * 0.29 + wave * 0.5, y - s * 0.96, s * 0.13);
    }
    ctx.restore();
  }

  function drawFence(row, cam) {
    var y = sy(row.index, cam) + view.rowH * 0.30;
    var s = view.tile;
    ctx.fillStyle = '#7a5c3a';
    for (var x = PP.World.CFG.X_MIN - 1; x <= PP.World.CFG.X_MAX + 1; x += 1) {
      var px = sx(x, cam);
      ctx.fillRect(px - s * 0.05, y - s * 0.42, s * 0.10, s * 0.42);
    }
    ctx.fillRect(0, y - s * 0.34, view.w, s * 0.07);
    ctx.fillRect(0, y - s * 0.18, view.w, s * 0.07);
  }

  function drawCoin(row, cam, t) {
    var c = row.coin;
    if (!c || c.taken) return;
    var x = sx(c.x, cam);
    var bob = Math.sin(t * 3 + c.bob) * view.tile * 0.07;
    var y = sy(row.index, cam) + view.rowH * 0.10 + bob;
    var s = view.tile;
    var squeeze = Math.abs(Math.cos(t * 2.2 + c.bob));

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    U.ellipse(ctx, x, sy(row.index, cam) + view.rowH * 0.24, s * 0.16, s * 0.06);
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
  }

  /* ── Vehicles ───────────────────────────────────────────────────── */

  function drawCar(row, car, cam) {
    var x = sx(PP.World.carX(row, car), cam);
    var y = sy(row.index, cam) + view.rowH * 0.26;
    var s = view.tile;
    var w = car.w * s;
    var dir = row.dir;

    if (x < -w || x > view.w + w) return;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    U.ellipse(ctx, x, y, w * 0.48, s * 0.13);
    ctx.fill();

    ctx.translate(x, y);
    ctx.scale(dir, 1);

    var bodyH = s * 0.42;
    var base = -s * 0.06;

    // Wheels.
    ctx.fillStyle = '#1b1b20';
    [-w * 0.30, w * 0.30].forEach(function (wx) {
      U.ellipse(ctx, wx, base, s * 0.11, s * 0.11);
      ctx.fill();
    });

    if (car.kind === 'tank') {
      ctx.fillStyle = '#2a2a2e';
      U.roundRect(ctx, -w / 2, base - s * 0.16, w, s * 0.22, s * 0.09);
      ctx.fill();
      ctx.fillStyle = car.color;
      U.roundRect(ctx, -w / 2 + s * 0.04, base - bodyH, w - s * 0.08, bodyH - s * 0.12, s * 0.06);
      ctx.fill();
      ctx.fillStyle = U.shade(car.color, 0.16);
      U.roundRect(ctx, -w * 0.14, base - bodyH - s * 0.26, w * 0.44, s * 0.28, s * 0.07);
      ctx.fill();
      ctx.fillRect(w * 0.28, base - bodyH - s * 0.16, w * 0.30, s * 0.06);
      ctx.fillStyle = '#c8102e';
      CH.star(ctx, -w * 0.22, base - bodyH * 0.55, s * 0.11);
    } else if (car.kind === 'truck') {
      ctx.fillStyle = U.shade(car.color, -0.2);
      U.roundRect(ctx, -w / 2, base - bodyH, w * 0.62, bodyH, s * 0.05);
      ctx.fill();
      ctx.fillStyle = '#8a7a63';
      U.roundRect(ctx, -w / 2 + s * 0.02, base - bodyH - s * 0.20, w * 0.58, s * 0.24, s * 0.08);
      ctx.fill();
      ctx.fillStyle = car.color;
      U.roundRect(ctx, w * 0.10, base - bodyH, w * 0.40, bodyH, s * 0.06);
      ctx.fill();
      ctx.fillStyle = 'rgba(180,220,235,0.85)';
      U.roundRect(ctx, w * 0.18, base - bodyH + s * 0.05, w * 0.24, s * 0.15, s * 0.03);
      ctx.fill();
      ctx.fillStyle = '#c8102e';
      CH.star(ctx, -w * 0.20, base - bodyH * 0.5, s * 0.10);
    } else if (car.kind === 'tractor') {
      ctx.fillStyle = '#1b1b20';
      U.ellipse(ctx, w * 0.28, base + s * 0.02, s * 0.17, s * 0.17);
      ctx.fill();
      ctx.fillStyle = car.color;
      U.roundRect(ctx, -w / 2, base - bodyH * 0.8, w * 0.9, bodyH * 0.8, s * 0.05);
      ctx.fill();
      ctx.fillStyle = U.shade(car.color, -0.25);
      ctx.fillRect(-w * 0.34, base - bodyH * 1.35, s * 0.10, bodyH * 0.55);
      ctx.fillStyle = '#f5c542';
      CH.star(ctx, -w * 0.10, base - bodyH * 0.45, s * 0.09);
    } else {
      ctx.fillStyle = car.color;
      U.roundRect(ctx, -w / 2, base - bodyH * 0.8, w, bodyH * 0.8, s * 0.07);
      ctx.fill();
      ctx.fillStyle = U.shade(car.color, 0.12);
      U.roundRect(ctx, -w * 0.28, base - bodyH * 1.28, w * 0.58, bodyH * 0.55, s * 0.06);
      ctx.fill();
      ctx.fillStyle = 'rgba(180,220,235,0.8)';
      U.roundRect(ctx, -w * 0.22, base - bodyH * 1.2, w * 0.22, bodyH * 0.38, s * 0.03);
      ctx.fill();
      U.roundRect(ctx, w * 0.04, base - bodyH * 1.2, w * 0.22, bodyH * 0.38, s * 0.03);
      ctx.fill();
      ctx.fillStyle = '#c8102e';
      CH.star(ctx, -w * 0.38, base - bodyH * 0.42, s * 0.09);
    }

    // Headlights, pointing the way it travels.
    ctx.fillStyle = 'rgba(255,238,170,0.9)';
    U.ellipse(ctx, w * 0.48, base - s * 0.16, s * 0.05, s * 0.05);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,238,170,0.09)';
    ctx.beginPath();
    ctx.moveTo(w * 0.48, base - s * 0.16);
    ctx.lineTo(w * 0.48 + s * 1.5, base - s * 0.5);
    ctx.lineTo(w * 0.48 + s * 1.5, base + s * 0.2);
    ctx.closePath();
    ctx.fill();

    // The driver: someone's very loyal pet.
    if (car.kind !== 'tank') {
      var skin = CH.enemySkin(car.skin);
      ctx.save();
      ctx.translate(car.kind === 'truck' ? w * 0.24 : 0, base - bodyH * (car.kind === 'truck' ? 1.0 : 1.28));
      ctx.scale(1, 1);
      CH.draw(ctx, 0, s * 0.30, {
        size: s * 0.52, char: skin, facing: 'right',
        cap: car.seed < 0.5 ? 'ushanka' : 'cap'
      });
      ctx.restore();
    }
    ctx.restore();
  }

  function drawTrain(row, cam) {
    var s = view.tile;
    var x = sx(row.trainX, cam);
    var w = row.trainW * s;
    var y = sy(row.index, cam) + view.rowH * 0.26;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x - w / 2, y - s * 0.05, w, s * 0.12);
    ctx.translate(x, y);
    ctx.scale(row.dir, 1);

    var h = s * 0.62;
    ctx.fillStyle = '#6d1622';
    U.roundRect(ctx, -w / 2, -h, w, h, s * 0.10);
    ctx.fill();
    ctx.fillStyle = '#8d1f2d';
    U.roundRect(ctx, -w / 2 + s * 0.06, -h + s * 0.05, w - s * 0.12, h * 0.35, s * 0.06);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,232,180,0.75)';
    for (var i = 0; i < row.trainW - 1; i++) {
      ctx.fillRect(-w / 2 + s * 0.35 + i * s, -h + s * 0.12, s * 0.42, s * 0.18);
    }
    ctx.fillStyle = '#f5c542';
    CH.star(ctx, w * 0.36, -h * 0.42, s * 0.16);
    ctx.fillStyle = 'rgba(255,240,190,0.95)';
    U.ellipse(ctx, w / 2 - s * 0.08, -h * 0.55, s * 0.09, s * 0.09);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,240,190,0.16)';
    ctx.beginPath();
    ctx.moveTo(w / 2, -h * 0.55);
    ctx.lineTo(w / 2 + s * 3.4, -h * 1.2);
    ctx.lineTo(w / 2 + s * 3.4, h * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawRailSignals(row, cam, t) {
    if (row.state === 'idle') return;
    var s = view.tile;
    var y = sy(row.index, cam) + view.rowH * 0.24;
    var blink = Math.sin(t * 18) > 0;
    [-1, 1].forEach(function (side) {
      var x = view.w / 2 + side * (view.w / 2 - s * 0.4);
      ctx.fillStyle = '#4a4038';
      ctx.fillRect(x - s * 0.04, y - s * 0.9, s * 0.08, s * 0.9);
      ctx.fillStyle = blink ? '#ff3b30' : '#5c2020';
      U.ellipse(ctx, x, y - s * 0.98, s * 0.13, s * 0.13);
      ctx.fill();
      if (blink) {
        ctx.fillStyle = 'rgba(255,59,48,0.22)';
        U.ellipse(ctx, x, y - s * 0.98, s * 0.34, s * 0.34);
        ctx.fill();
      }
    });
  }

  function drawLog(row, lg, cam) {
    var x = sx(PP.World.logX(row, lg), cam);
    var s = view.tile;
    var w = lg.w * s;
    var y = sy(row.index, cam) + view.rowH * 0.20;
    if (x < -w || x > view.w + w) return;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    U.ellipse(ctx, x, y + s * 0.10, w * 0.46, s * 0.10);
    ctx.fill();

    if (lg.kind === 'raft') {
      ctx.fillStyle = '#9a6b3d';
      U.roundRect(ctx, x - w / 2, y - s * 0.18, w, s * 0.26, s * 0.05);
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
      ctx.fillStyle = '#8e6039';
      U.roundRect(ctx, x - w / 2 + s * 0.05, y - s * 0.20, w - s * 0.1, s * 0.14, s * 0.07);
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

  /* ── The Collective ─────────────────────────────────────────────── */

  function drawTideBand(row, cam, tideRow, t) {
    var d = tideRow - row.index;      // how deeply this row is swallowed
    if (d < 0) return;
    var top = sy(row.index, cam) - view.rowH / 2;
    var a = U.clamp(0.22 + d * 0.09, 0, 0.78);
    ctx.fillStyle = 'rgba(150,10,26,' + a + ')';
    ctx.fillRect(0, top, view.w, view.rowH + 1);
    if (d < 3) {
      ctx.fillStyle = 'rgba(255,90,70,' + (0.16 * (3 - d) / 3) + ')';
      ctx.fillRect(0, top, view.w, view.rowH + 1);
    }
  }

  function drawTideFront(cam, tideRow, t) {
    var s = view.tile;
    var y = sy(tideRow, cam) + view.rowH * 0.26;

    // Smoke/haze rolling off the front line.
    var g = ctx.createLinearGradient(0, y - s * 1.6, 0, y + s * 0.6);
    g.addColorStop(0, 'rgba(180,20,35,0)');
    g.addColorStop(1, 'rgba(150,10,26,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y - s * 1.6, view.w, s * 2.2);

    // A rank of marchers with banners, stepping in time.
    var spacing = s * 0.92;
    var offset = U.mod(-cam.x * view.tile, spacing);
    var idx = 0;
    for (var px = offset - spacing; px < view.w + spacing; px += spacing, idx++) {
      var bounce = Math.abs(Math.sin(t * 5 + idx * 1.3)) * s * 0.10;
      var skin = CH.enemySkin(idx);
      if (idx % 4 === 1) {
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
      CH.draw(ctx, px, y - bounce, {
        size: s * 0.78, char: skin, facing: 'up',
        cap: idx % 3 === 0 ? 'ushanka' : 'cap', alpha: 0.95
      });
    }
  }

  /* ── Player + effects ───────────────────────────────────────────── */

  function drawPlayer(p, cam, char) {
    if (p.dead && p.deathKind === 'water' && p.sinkT > 0.9) return;
    var x = sx(p.x, cam);
    var y = sy(p.row, cam) + view.rowH * 0.24;
    var s = view.tile;
    var opts = {
      size: s * 1.02, char: char, facing: p.facing,
      squash: p.squash, lift: p.lift * s, alpha: 1
    };
    if (p.dead) {
      if (p.deathKind === 'squash') {
        opts.squash = 0.85;
        opts.lift = 0;
      } else if (p.deathKind === 'water') {
        opts.alpha = 1 - p.sinkT;
        opts.lift = -p.sinkT * s * 0.35;
      }
    }
    CH.draw(ctx, x, y, opts);
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

    ctx.save();
    if (g.shake > 0.001) {
      ctx.translate((Math.random() - 0.5) * g.shake * 18, (Math.random() - 0.5) * g.shake * 18);
    }

    // How far ahead we can see. The skyline is planted exactly on that edge
    // so the ground and the city meet without a seam.
    var depth = U.clamp((view.baseY - view.h * 0.17) / view.rowH, 6, 16);
    var farRow = Math.floor(cam.row + depth);
    var nearRow = Math.floor(cam.row - (view.h - view.baseY) / view.rowH) - 1;
    drawSky(cam, t, sy(farRow, cam) + view.rowH / 2);

    var playerDrawRow = Math.round(g.player.row);

    for (var i = farRow; i >= nearRow; i--) {
      // Rows behind the start line don't exist; the tide is already there,
      // but draw plain ground so the screen never shows a hole.
      var row = i < 0 ? { index: i, type: 'grass', decor: [], blocked: {}, coin: null } : PP.World.row(i);
      if (!row) continue;

      drawBand(row, cam, t);

      if (row.type === 'grass') {
        if (row.fence) drawFence(row, cam);
        for (var d = 0; d < row.decor.length; d++) drawDecor(row, row.decor[d], cam);
        drawCoin(row, cam, t);
      } else if (row.type === 'road') {
        for (var c = 0; c < row.cars.length; c++) drawCar(row, row.cars[c], cam);
      } else if (row.type === 'water') {
        for (var l = 0; l < row.logs.length; l++) drawLog(row, row.logs[l], cam);
      } else if (row.type === 'rail') {
        if (row.state === 'train') drawTrain(row, cam);
        drawRailSignals(row, cam, t);
      }

      if (g.tide.row >= i) drawTideBand(row, cam, g.tide.row, t);
      if (Math.floor(g.tide.row) === i) drawTideFront(cam, g.tide.row, t);

      if (i === playerDrawRow && g.showPlayer) drawPlayer(g.player, cam, g.char);
    }

    // Distance haze: the far rows dissolve into the smog.
    var hzY = sy(farRow, cam) + view.rowH / 2;
    var hz = ctx.createLinearGradient(0, hzY - view.rowH * 0.2, 0, hzY + view.rowH * 3.2);
    hz.addColorStop(0, 'rgba(196,120,84,0.85)');
    hz.addColorStop(1, 'rgba(196,120,84,0)');
    ctx.fillStyle = hz;
    ctx.fillRect(0, hzY - view.rowH * 0.2, view.w, view.rowH * 3.4);

    // Out of bounds: everything past the walkable columns falls into shadow,
    // so a wide screen still reads as a corridor you cannot leave.
    var bl = sx(PP.World.CFG.X_MIN - 0.5, cam);
    var br = sx(PP.World.CFG.X_MAX + 0.5, cam);
    if (bl > 0) {
      var lg2 = ctx.createLinearGradient(0, 0, bl, 0);
      lg2.addColorStop(0, 'rgba(12,8,16,0.62)');
      lg2.addColorStop(1, 'rgba(12,8,16,0)');
      ctx.fillStyle = lg2;
      ctx.fillRect(0, 0, bl, view.h);
    }
    if (br < view.w) {
      var rg2 = ctx.createLinearGradient(view.w, 0, br, 0);
      rg2.addColorStop(0, 'rgba(12,8,16,0.62)');
      rg2.addColorStop(1, 'rgba(12,8,16,0)');
      ctx.fillStyle = rg2;
      ctx.fillRect(br, 0, view.w - br, view.h);
    }

    drawParticles(g.particles, cam);
    drawFloaters(g.floaters, cam);
    ctx.restore();

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
    },
    resize: resize,
    draw: draw,
    drawPortrait: drawPortrait,
    sx: sx,
    sy: sy
  };
})(window);
