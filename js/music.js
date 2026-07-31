/* An 8-bit march for the soundtrack.
 *
 * Original composition — a minor-key parade tune with the genre's furniture:
 * a stomping root-and-fifth bass, fanfare leaps in fourths and fifths, and a
 * snare on the backbeat. Three voices, all synthesised: pulse lead, triangle
 * bass, filtered-noise drums.
 *
 * Notes are scheduled ahead of the audio clock rather than fired from
 * setInterval, so the beat doesn't wobble when the game drops a frame. */
(function (global) {
  'use strict';

  var PP = global.PP;
  var U = PP.U;

  var BPM = 116;            // parade pace
  var URGENT_BPM = 132;     // when the tide is breathing down your neck
  var LOOKAHEAD = 0.14;     // seconds of notes queued in advance
  var TICK = 25;            // scheduler wake-up, ms

  /* ── The tune ───────────────────────────────────────────────────────
     Written in D minor. Melody as [midi, length-in-16ths]; 0 is a rest.
     60 = middle C, so D4 = 62. */
  var A_MELODY = [
    [62, 4], [62, 4], [69, 4], [69, 4],          // D  D  A  A
    [70, 4], [69, 4], [67, 4], [65, 4],          // Bb A  G  F
    [64, 4], [65, 4], [67, 4], [64, 4],          // E  F  G  E
    [62, 8], [0, 8],
    [65, 4], [65, 4], [72, 4], [72, 4],          // F  F  C  C
    [74, 4], [72, 4], [70, 4], [69, 4],          // D  C  Bb A
    [67, 4], [69, 4], [70, 4], [67, 4],          // G  A  Bb G
    [69, 8], [0, 8]
  ];

  var B_MELODY = [
    [74, 4], [74, 4], [74, 4], [72, 4],          // D  D  D  C
    [70, 4], [72, 4], [74, 8],
    [69, 4], [70, 4], [72, 4], [70, 4],
    [69, 4], [67, 4], [65, 8],
    [67, 4], [69, 4], [70, 4], [72, 4],
    [74, 8], [72, 8],
    [70, 4], [69, 4], [67, 4], [65, 4],
    [64, 8], [57, 8]                             // land on the dominant
  ];

  /* One chord root per bar, 16 bars total. */
  var CHORDS = [
    38, 46, 45, 38, 41, 38, 43, 45,              // D  Bb A  D  F  D  G  A
    38, 43, 45, 38, 43, 38, 43, 45
  ];

  var STEPS_PER_BAR = 16;
  var BARS = 16;
  var TOTAL_STEPS = STEPS_PER_BAR * BARS;

  /* Expand a [note, length] melody into { step: [midi, len] }. */
  function expand(melody, startStep) {
    var map = {}, step = startStep;
    for (var i = 0; i < melody.length; i++) {
      var note = melody[i][0], len = melody[i][1];
      if (note) map[step] = [note, len];
      step += len;
    }
    return map;
  }

  var LEAD = {};
  (function () {
    var a = expand(A_MELODY, 0);
    var b = expand(B_MELODY, 8 * STEPS_PER_BAR);
    var k;
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) LEAD[k] = a[k];
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) LEAD[k] = b[k];
  })();

  var ctx = null, bus = null, timer = null;
  var playing = false, muted = false, urgent = false;
  var step = 0, nextTime = 0;

  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function stepSeconds() {
    return 60 / (urgent ? URGENT_BPM : BPM) / 4;   // one 16th note
  }

  /* ── Voices ─────────────────────────────────────────────────────── */

  function pulse(freq, at, dur, gainPeak, type) {
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, at);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(gainPeak, at + 0.012);
    g.gain.setValueAtTime(gainPeak * 0.75, at + Math.max(0.02, dur * 0.55));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g);
    g.connect(bus);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  function drum(at, kind) {
    var dur = kind === 'kick' ? 0.14 : 0.11;
    if (kind === 'kick') {
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, at);
      osc.frequency.exponentialRampToValueAtTime(45, at + dur);
      g.gain.setValueAtTime(0.5, at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(g);
      g.connect(bus);
      osc.start(at);
      osc.stop(at + dur + 0.02);
      return;
    }
    // Snare: a short burst of high-passed noise.
    var frames = Math.floor(ctx.sampleRate * dur);
    var buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = kind === 'snare' ? 1400 : 5000;
    var sg = ctx.createGain();
    sg.gain.value = kind === 'snare' ? 0.30 : 0.07;
    src.connect(hp);
    hp.connect(sg);
    sg.connect(bus);
    src.start(at);
  }

  /* ── Sequencer ──────────────────────────────────────────────────── */

  function scheduleStep(s, at) {
    var bar = Math.floor(s / STEPS_PER_BAR);
    var beat = s % STEPS_PER_BAR;
    var sec = stepSeconds();

    // Lead.
    var note = LEAD[s];
    if (note) {
      pulse(midiToFreq(note[0]), at, note[1] * sec * 0.92, 0.10);
      // A fifth above, quieter — cheap brass thickness.
      pulse(midiToFreq(note[0] + 7), at, note[1] * sec * 0.92, 0.035);
    }

    // Bass: root, fifth, root, fifth on the quarters. Marching feet.
    if (beat % 4 === 0) {
      var root = CHORDS[bar % CHORDS.length];
      var n = (beat === 0 || beat === 8) ? root : root + 7;
      pulse(midiToFreq(n - 12), at, sec * 3.4, 0.20, 'triangle');
    }

    // Drums.
    if (beat === 0 || beat === 8) drum(at, 'kick');
    if (beat === 4 || beat === 12) drum(at, 'snare');
    if (beat % 2 === 0) drum(at, 'hat');
    // Fill into each 4-bar phrase.
    if (bar % 4 === 3 && beat >= 12) drum(at, 'snare');
  }

  function scheduler() {
    if (!playing || !ctx) return;
    while (nextTime < ctx.currentTime + LOOKAHEAD) {
      scheduleStep(step, nextTime);
      nextTime += stepSeconds();
      step = (step + 1) % TOTAL_STEPS;
    }
  }

  var Music = {
    setMuted: function (m) {
      muted = m;
      if (muted) Music.stop();
    },

    isPlaying: function () { return playing; },

    start: function () {
      if (playing || muted) return;
      ctx = PP.Audio.context();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      if (!bus) {
        bus = ctx.createGain();
        bus.gain.value = 0.5;               // sits under the effects
        bus.connect(PP.Audio.destination() || ctx.destination);
      }
      // Cancel any fade still in flight, or a quick restart begins silent.
      bus.gain.cancelScheduledValues(ctx.currentTime);
      bus.gain.setValueAtTime(0.5, ctx.currentTime);
      playing = true;
      step = 0;
      nextTime = ctx.currentTime + 0.08;
      timer = global.setInterval(scheduler, TICK);
      scheduler();
    },

    stop: function () {
      playing = false;
      if (timer) { global.clearInterval(timer); timer = null; }
    },

    /* Pick the tempo up when the Collective closes in. */
    setUrgent: function (on) { urgent = !!on; },

    /* Cut the music but let whatever is already queued ring out. */
    fadeOut: function (seconds) {
      if (!bus || !ctx) { Music.stop(); return; }
      var now = ctx.currentTime;
      bus.gain.cancelScheduledValues(now);
      bus.gain.setValueAtTime(bus.gain.value, now);
      bus.gain.exponentialRampToValueAtTime(0.0001, now + (seconds || 0.6));
      Music.stop();
      global.setTimeout(function () {
        if (bus) bus.gain.setValueAtTime(0.5, ctx.currentTime);
      }, (seconds || 0.6) * 1000 + 60);
    },

    /* The march wins: a short, smug cadence when you are caught. */
    victoryOfTheCollective: function () {
      if (muted) return;
      var c = PP.Audio.context();
      if (!c) return;
      ctx = c;
      if (!bus) {
        bus = ctx.createGain();
        bus.gain.value = 0.5;
        bus.connect(PP.Audio.destination() || ctx.destination);
      }
      bus.gain.setValueAtTime(0.5, ctx.currentTime);
      var t0 = ctx.currentTime + 0.05;
      [[57, 0], [62, 0.16], [65, 0.32], [69, 0.48], [74, 0.64]].forEach(function (e) {
        pulse(midiToFreq(e[0]), t0 + e[1], 0.22, 0.13);
        pulse(midiToFreq(e[0] - 12), t0 + e[1], 0.22, 0.16, 'triangle');
      });
      drum(t0 + 0.64, 'kick');
      drum(t0 + 0.80, 'snare');
    }
  };

  muted = PP.Audio.isMuted();
  PP.Music = Music;
})(window);
