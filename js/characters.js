/* The roster, plus the procedural critter renderer used for the player,
   the enemy drivers and the marchers in the red tide. No sprite sheets:
   every animal is drawn from primitives so it scales to any resolution. */
(function (global) {
  'use strict';

  var PP = global.PP;
  var U = PP.U;

  /* ── Roster ─────────────────────────────────────────────────────────
     species  cat | dog   (drives ears, tail and face details)
     price    0 means unlocked from the start                         */
  var ROSTER = [
    {
      id: 'mittens', name: 'Mittens', species: 'cat', price: 0,
      tag: 'Refused to share the sunbeam',
      fur: '#e08a3c', belly: '#f7dcae', accent: '#3fa9d6', eye: '#2b2118',
      ears: 'cat', tail: 'long', stripes: true
    },
    {
      id: 'biscuit', name: 'Biscuit', species: 'dog', price: 0,
      tag: 'Short legs, long memory',
      fur: '#e8b060', belly: '#fdf1dc', accent: '#c8102e', eye: '#241a12',
      ears: 'perk', tail: 'stub', short: true
    },
    {
      id: 'boris', name: 'Boris', species: 'dog', price: 60,
      tag: 'Deserted the sled team',
      fur: '#8d99a8', belly: '#f2f5f8', accent: '#2f4d6e', eye: '#5fc6e8',
      ears: 'perk', tail: 'fluffy', mask: true
    },
    {
      id: 'duchess', name: 'Duchess', species: 'cat', price: 90,
      tag: 'Owned three cushions. Three.',
      fur: '#efe6d8', belly: '#fffaf0', accent: '#b07fd0', eye: '#4ea3e0',
      ears: 'cat', tail: 'long', points: true
    },
    {
      id: 'sputnik', name: 'Sputnik', species: 'cat', price: 120,
      tag: 'Defected by balloon, twice',
      fur: '#33313c', belly: '#5a5866', accent: '#f5c542', eye: '#8ee36a',
      ears: 'cat', tail: 'long', goggles: true
    },
    {
      id: 'pierogi', name: 'Pierogi', species: 'dog', price: 150,
      tag: 'Smuggled out in a bread basket',
      fur: '#6a4325', belly: '#c8975f', accent: '#e4a11b', eye: '#1e1610',
      ears: 'floppy', tail: 'long', short: true
    },
    {
      id: 'marshal', name: 'Marshal Fluff', species: 'cat', price: 220,
      tag: 'Declared herself a sovereign state',
      fur: '#f0d79a', belly: '#fff5dd', accent: '#c8102e', eye: '#e08a3c',
      ears: 'cat', tail: 'fluffy', crown: true, fluffy: true
    },
    {
      id: 'kotleta', name: 'Kotleta', species: 'cat', price: -1, secret: true,
      tag: 'Was never here. You saw nothing.',
      fur: '#7b7469', belly: '#a99f92', accent: '#3a3f4a', eye: '#cfd8e0',
      ears: 'cat', tail: 'long', glasses: true, flatcap: true
    },
    {
      id: 'laika', name: 'Laika', species: 'dog', price: 300,
      tag: 'Came back. Wants a word.',
      fur: '#cfc6bb', belly: '#ffffff', accent: '#d0d6dd', eye: '#3a2f26',
      ears: 'perk', tail: 'curl', helmet: true, patch: true
    }
  ];

  var BY_ID = {};
  ROSTER.forEach(function (c) { BY_ID[c.id] = c; });

  /* Palette used for the regime's own cats and dogs. */
  var ENEMY_SKINS = [
    { fur: '#7a7f88', belly: '#b9bdc4', eye: '#1a1a1a', species: 'cat', ears: 'cat', tail: 'long' },
    { fur: '#5c5148', belly: '#8f8378', eye: '#1a1a1a', species: 'dog', ears: 'floppy', tail: 'long' },
    { fur: '#3f4148', belly: '#6b6e77', eye: '#1a1a1a', species: 'dog', ears: 'perk', tail: 'stub' },
    { fur: '#9a8f80', belly: '#cec4b6', eye: '#1a1a1a', species: 'cat', ears: 'cat', tail: 'fluffy' }
  ];

  /* ── Renderer ───────────────────────────────────────────────────────
     Draws a chunky, blocky animal with its feet at (x, y).
     opts: { size, char, facing: 'up'|'down'|'left'|'right',
             squash: -1..1, lift: px, alpha, cap: 'ushanka'|'cap'|null } */
  function drawCritter(ctx, x, y, opts) {
    var c = opts.char || ROSTER[0];
    var s = opts.size;
    var facing = opts.facing || 'down';
    var squash = opts.squash || 0;
    var lift = opts.lift || 0;

    var bodyW = s * (c.fluffy ? 0.70 : 0.62);
    var bodyH = s * (c.short ? 0.32 : 0.38);
    var headW = bodyW * 0.94;
    var headH = s * 0.40;
    var legH = s * (c.short ? 0.07 : 0.12);

    var sideOn = (facing === 'left' || facing === 'right');
    var away = (facing === 'up');
    var flip = (facing === 'left') ? -1 : 1;

    ctx.save();
    ctx.globalAlpha = opts.alpha === undefined ? 1 : opts.alpha;

    /* Contact shadow stays on the ground even while the critter is airborne. */
    ctx.save();
    ctx.globalAlpha = (opts.alpha === undefined ? 1 : opts.alpha) * (0.28 - Math.min(lift, s) / s * 0.12);
    ctx.fillStyle = '#251536';
    U.ellipse(ctx, x, y, bodyW * 0.62, bodyW * 0.24);
    ctx.fill();
    ctx.restore();

    ctx.translate(x, y - lift);
    ctx.scale(flip * (1 + squash * 0.35), 1 - squash * 0.35);

    var dark = U.shade(c.fur, -0.28);
    var light = U.shade(c.fur, 0.18);

    /* Tail (behind the body). Sways idly; tucks low when afraid. */
    ctx.strokeStyle = dark;
    ctx.lineCap = 'round';
    var tailBaseY = -legH - bodyH * 0.55;
    var fear = opts.fear || 0;
    var tnow = PP.World ? PP.World.time() : 0;
    var sway = Math.sin(tnow * 2.1) * s * 0.05 * (1 - fear);
    if (c.tail === 'long' || c.tail === 'curl') {
      ctx.lineWidth = s * 0.09;
      ctx.beginPath();
      ctx.moveTo(-bodyW * 0.42, tailBaseY);
      if (c.tail === 'curl') {
        ctx.quadraticCurveTo(-bodyW * 0.95 + sway, tailBaseY - s * 0.30 + fear * s * 0.34,
          -bodyW * 0.35, tailBaseY - s * 0.42 + fear * s * 0.38);
      } else {
        ctx.quadraticCurveTo(-bodyW * 0.95 + sway, tailBaseY + s * 0.02 + fear * s * 0.18,
          -bodyW * 0.80 + sway * 0.6, tailBaseY - s * 0.34 + fear * s * 0.40);
      }
      ctx.stroke();
    } else if (c.tail === 'fluffy') {
      ctx.fillStyle = dark;
      U.ellipse(ctx, -bodyW * 0.62, tailBaseY - s * 0.06, s * 0.17, s * 0.24);
      ctx.fill();
    } else {
      ctx.lineWidth = s * 0.10;
      ctx.beginPath();
      ctx.moveTo(-bodyW * 0.40, tailBaseY);
      ctx.lineTo(-bodyW * 0.62, tailBaseY - s * 0.10);
      ctx.stroke();
    }

    /* Legs. */
    ctx.fillStyle = dark;
    var legW = bodyW * 0.22;
    U.roundRect(ctx, -bodyW * 0.34, -legH, legW, legH + 1, legW * 0.35);
    ctx.fill();
    U.roundRect(ctx, bodyW * 0.34 - legW, -legH, legW, legH + 1, legW * 0.35);
    ctx.fill();

    /* Body. */
    var bodyTop = -legH - bodyH;
    ctx.fillStyle = c.fur;
    U.roundRect(ctx, -bodyW / 2, bodyTop, bodyW, bodyH, bodyW * 0.22);
    ctx.fill();
    if (!away) {
      ctx.fillStyle = c.belly;
      U.roundRect(ctx, -bodyW * 0.26, bodyTop + bodyH * 0.28, bodyW * 0.52, bodyH * 0.78, bodyW * 0.16);
      ctx.fill();
    }
    if (c.patch) {
      ctx.fillStyle = U.shade(c.fur, -0.45);
      U.ellipse(ctx, bodyW * 0.22, bodyTop + bodyH * 0.45, bodyW * 0.16, bodyH * 0.3);
      ctx.fill();
    }

    /* Head. */
    var headBottom = bodyTop + bodyH * 0.16;
    var headTop = headBottom - headH;
    var hx = -headW / 2;

    /* Ears go behind the head block so they read as silhouette. */
    ctx.fillStyle = c.fur;
    if (c.ears === 'cat' || c.ears === 'perk') {
      var earW = headW * (c.ears === 'cat' ? 0.30 : 0.26);
      var earH = headH * (c.ears === 'cat' ? 0.52 : 0.44);
      earH *= (1 - 0.42 * fear);            // ears pin back when afraid
      [-1, 1].forEach(function (sgn) {
        var ex = sgn * headW * 0.30;
        ctx.beginPath();
        ctx.moveTo(ex - earW / 2, headTop + earH * 0.5);
        ctx.lineTo(ex + sgn * earW * (0.10 + 0.45 * fear), headTop - earH * 0.55);
        ctx.lineTo(ex + earW / 2, headTop + earH * 0.5);
        ctx.closePath();
        ctx.fill();
        if (!away) {
          ctx.fillStyle = U.shade(c.belly, -0.06);
          ctx.beginPath();
          ctx.moveTo(ex - earW * 0.24, headTop + earH * 0.34);
          ctx.lineTo(ex, headTop - earH * 0.18);
          ctx.lineTo(ex + earW * 0.24, headTop + earH * 0.34);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = c.fur;
        }
      });
    } else { /* floppy */
      ctx.fillStyle = U.shade(c.fur, -0.18);
      [-1, 1].forEach(function (sgn) {
        U.roundRect(ctx, sgn * headW * 0.42 - headW * 0.14, headTop + headH * 0.06,
          headW * 0.28, headH * 0.78, headW * 0.13);
        ctx.fill();
      });
      ctx.fillStyle = c.fur;
    }

    ctx.fillStyle = c.fur;
    U.roundRect(ctx, hx, headTop, headW, headH, headW * 0.26);
    ctx.fill();

    if (c.points) { /* siamese mask */
      ctx.fillStyle = U.shade(c.fur, -0.42);
      U.roundRect(ctx, hx + headW * 0.16, headTop + headH * 0.30, headW * 0.68, headH * 0.66, headW * 0.2);
      ctx.fill();
    }
    if (c.mask) {
      ctx.fillStyle = c.belly;
      U.roundRect(ctx, hx + headW * 0.20, headTop + headH * 0.34, headW * 0.60, headH * 0.62, headW * 0.2);
      ctx.fill();
    }

    if (away) {
      /* Back of the head — a couple of tufts, no face. */
      ctx.fillStyle = U.shade(c.fur, -0.12);
      U.roundRect(ctx, hx + headW * 0.18, headTop + headH * 0.22, headW * 0.64, headH * 0.42, headW * 0.18);
      ctx.fill();
    } else {
      var faceY = headTop + headH * 0.52;
      var eyeDX = headW * (sideOn ? 0.16 : 0.22);
      var eyeOffset = sideOn ? headW * 0.16 : 0;

      /* Eyes. */
      ctx.fillStyle = '#fff';
      [-1, 1].forEach(function (sgn) {
        if (sideOn && sgn < 0) return;
        U.ellipse(ctx, eyeOffset + sgn * eyeDX, faceY, headW * 0.105, headW * 0.125);
        ctx.fill();
      });
      ctx.fillStyle = c.eye;
      [-1, 1].forEach(function (sgn) {
        if (sideOn && sgn < 0) return;
        U.ellipse(ctx, eyeOffset + sgn * eyeDX + (sideOn ? headW * 0.02 : 0), faceY,
          headW * (c.species === 'cat' ? 0.045 : 0.06), headW * 0.085);
        ctx.fill();
      });
      // A pinpoint catchlight makes the eyes read as alive.
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      [-1, 1].forEach(function (sgn) {
        if (sideOn && sgn < 0) return;
        U.ellipse(ctx, eyeOffset + sgn * eyeDX + headW * 0.025, faceY - headW * 0.03,
          headW * 0.024, headW * 0.028);
        ctx.fill();
      });

      /* Muzzle + nose. */
      var muzY = faceY + headH * 0.26;
      ctx.fillStyle = c.belly;
      U.ellipse(ctx, eyeOffset * 0.6, muzY, headW * (c.species === 'dog' ? 0.26 : 0.22), headH * 0.16);
      ctx.fill();
      ctx.fillStyle = c.species === 'dog' ? '#2a2020' : '#e08a9a';
      ctx.beginPath();
      ctx.moveTo(eyeOffset * 0.6 - headW * 0.05, muzY - headH * 0.06);
      ctx.lineTo(eyeOffset * 0.6 + headW * 0.05, muzY - headH * 0.06);
      ctx.lineTo(eyeOffset * 0.6, muzY + headH * 0.02);
      ctx.closePath();
      ctx.fill();

      /* Whiskers. */
      if (c.species === 'cat') {
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = Math.max(1, s * 0.012);
        [-1, 1].forEach(function (sgn) {
          if (sideOn && sgn < 0) return;
          ctx.beginPath();
          ctx.moveTo(eyeOffset * 0.6 + sgn * headW * 0.14, muzY);
          ctx.lineTo(eyeOffset * 0.6 + sgn * headW * 0.46, muzY - headH * 0.06);
          ctx.moveTo(eyeOffset * 0.6 + sgn * headW * 0.14, muzY + headH * 0.04);
          ctx.lineTo(eyeOffset * 0.6 + sgn * headW * 0.44, muzY + headH * 0.10);
          ctx.stroke();
        });
      }

      if (c.glasses) {
        ctx.fillStyle = '#20242c';
        [-1, 1].forEach(function (sgn) {
          if (sideOn && sgn < 0) return;
          U.ellipse(ctx, eyeOffset + sgn * eyeDX, faceY, headW * 0.115, headW * 0.115);
          ctx.fill();
        });
        ctx.strokeStyle = '#20242c';
        ctx.lineWidth = Math.max(1.5, s * 0.02);
        ctx.beginPath();
        ctx.moveTo(eyeOffset - eyeDX + headW * 0.115, faceY);
        ctx.lineTo(eyeOffset + eyeDX - headW * 0.115, faceY);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = Math.max(1, s * 0.012);
        [-1, 1].forEach(function (sgn) {
          if (sideOn && sgn < 0) return;
          ctx.beginPath();
          ctx.arc(eyeOffset + sgn * eyeDX - headW * 0.03, faceY - headW * 0.03, headW * 0.05, Math.PI, Math.PI * 1.5);
          ctx.stroke();
        });
      }

      if (c.goggles) {
        ctx.strokeStyle = '#6b5a3e';
        ctx.lineWidth = s * 0.05;
        ctx.beginPath();
        ctx.moveTo(hx, headTop + headH * 0.30);
        ctx.lineTo(hx + headW, headTop + headH * 0.30);
        ctx.stroke();
        ctx.fillStyle = 'rgba(180,220,255,0.85)';
        [-1, 1].forEach(function (sgn) {
          U.ellipse(ctx, sgn * headW * 0.22, headTop + headH * 0.30, headW * 0.16, headW * 0.13);
          ctx.fill();
        });
      }
    }

    /* Collar / accessories. */
    if (c.accent) {
      ctx.fillStyle = c.accent;
      U.roundRect(ctx, hx + headW * 0.06, headBottom - headH * 0.02, headW * 0.88, s * 0.055, s * 0.03);
      ctx.fill();
      ctx.fillStyle = U.shade(c.accent, 0.35);
      U.ellipse(ctx, 0, headBottom + s * 0.045, s * 0.035, s * 0.035);
      ctx.fill();
    }

    if (c.crown) {
      ctx.fillStyle = '#f5c542';
      ctx.beginPath();
      ctx.moveTo(-headW * 0.30, headTop - headH * 0.02);
      ctx.lineTo(-headW * 0.30, headTop - headH * 0.34);
      ctx.lineTo(-headW * 0.12, headTop - headH * 0.16);
      ctx.lineTo(0, headTop - headH * 0.40);
      ctx.lineTo(headW * 0.12, headTop - headH * 0.16);
      ctx.lineTo(headW * 0.30, headTop - headH * 0.34);
      ctx.lineTo(headW * 0.30, headTop - headH * 0.02);
      ctx.closePath();
      ctx.fill();
    }

    if (c.helmet) {
      ctx.fillStyle = 'rgba(230,240,250,0.55)';
      ctx.beginPath();
      ctx.arc(0, headTop + headH * 0.42, headW * 0.62, Math.PI * 1.06, Math.PI * 1.94);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#cfd8e3';
      ctx.lineWidth = s * 0.03;
      ctx.stroke();
    }

    if (c.flatcap) {
      ctx.fillStyle = '#6a655c';
      U.roundRect(ctx, hx + headW * 0.02, headTop - headH * 0.14, headW * 0.96, headH * 0.26, headW * 0.12);
      ctx.fill();
      ctx.fillStyle = '#59554d';
      U.roundRect(ctx, hx + headW * 0.3, headTop + headH * 0.08, headW * 0.72, headH * 0.09, headW * 0.04);
      ctx.fill();
    }

    /* Regime headgear, used for drivers, marchers and the newly converted.
       capT animates the hat dropping onto the head. */
    var capT = opts.capT === undefined ? 1 : U.clamp(opts.capT, 0, 1);
    if (opts.cap && capT > 0.02) {
      ctx.save();
      ctx.globalAlpha *= capT;
      ctx.translate(0, -(1 - capT) * headH * 1.1);
    }
    if (opts.cap === 'ushanka' && capT > 0.02) {
      ctx.fillStyle = '#4a3a2c';
      U.roundRect(ctx, hx - headW * 0.06, headTop - headH * 0.26, headW * 1.12, headH * 0.42, headW * 0.18);
      ctx.fill();
      ctx.fillStyle = '#c8102e';
      star(ctx, 0, headTop - headH * 0.06, headW * 0.17);
    } else if (opts.cap === 'cap' && capT > 0.02) {
      ctx.fillStyle = '#5a6a4a';
      U.roundRect(ctx, hx - headW * 0.04, headTop - headH * 0.16, headW * 1.08, headH * 0.30, headW * 0.1);
      ctx.fill();
      ctx.fillStyle = '#3d4834';
      U.roundRect(ctx, hx, headTop + headH * 0.10, headW, headH * 0.10, headW * 0.05);
      ctx.fill();
      ctx.fillStyle = '#c8102e';
      star(ctx, 0, headTop - headH * 0.01, headW * 0.14);
    }
    if (opts.cap && capT > 0.02) ctx.restore();

    ctx.restore();
  }

  /* Five-pointed star, used a lot around here. */
  function star(ctx, cx, cy, r) {
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var rad = (i % 2 === 0) ? r : r * 0.42;
      var a = -Math.PI / 2 + i * Math.PI / 5;
      var px = cx + Math.cos(a) * rad;
      var py = cy + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  PP.Characters = {
    ROSTER: ROSTER,
    byId: function (id) { return BY_ID[id] || ROSTER[0]; },
    enemySkin: function (i) { return ENEMY_SKINS[U.mod(i, ENEMY_SKINS.length)]; },
    draw: drawCritter,
    star: star
  };
})(window);
