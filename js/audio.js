/* Tiny synthesised sound bank — no asset files, everything is WebAudio. */
(function (global) {
  'use strict';

  var PP = global.PP;
  var U = PP.U;

  var ctx = null;
  var master = null;
  var muted = U.store.get('pp.muted', false);

  function ensure() {
    if (ctx) return ctx;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
    } catch (e) { ctx = null; }
    return ctx;
  }

  /* One shot: oscillator with a frequency ramp and a percussive envelope. */
  function tone(opts) {
    if (muted) return;
    var c = ensure();
    if (!c) return;
    if (c.state === 'suspended') c.resume();

    var t0 = c.currentTime + (opts.delay || 0);
    var dur = opts.dur || 0.12;
    var osc = c.createOscillator();
    var gain = c.createGain();

    osc.type = opts.type || 'square';
    osc.frequency.setValueAtTime(opts.from, t0);
    if (opts.to && opts.to !== opts.from) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(opts.to, 1), t0 + dur);
    }

    var peak = (opts.gain === undefined ? 0.6 : opts.gain);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /* Filtered noise burst — splashes, crashes, engine rumble. */
  function noise(opts) {
    if (muted) return;
    var c = ensure();
    if (!c) return;
    if (c.state === 'suspended') c.resume();

    var dur = opts.dur || 0.25;
    var frames = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, frames, c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

    var src = c.createBufferSource();
    src.buffer = buf;

    var filter = c.createBiquadFilter();
    filter.type = opts.filter || 'lowpass';
    filter.frequency.setValueAtTime(opts.freq || 900, c.currentTime);
    if (opts.sweepTo) {
      filter.frequency.exponentialRampToValueAtTime(opts.sweepTo, c.currentTime + dur);
    }

    var gain = c.createGain();
    gain.gain.setValueAtTime(opts.gain || 0.35, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start();
  }

  var Audio = {
    isMuted: function () { return muted; },

    /* Shared with the music sequencer so both run on one context. */
    context: ensure,
    destination: function () { return master; },

    toggleMute: function () {
      muted = !muted;
      U.store.set('pp.muted', muted);
      if (PP.Music) PP.Music.setMuted(muted);
      if (!muted) Audio.blip();
      return muted;
    },

    /* Browsers only allow audio after a gesture; call this from any input. */
    unlock: function () {
      var c = ensure();
      if (c && c.state === 'suspended') c.resume();
    },

    hop: function (mul) {
      mul = mul || 1;
      tone({ type: 'square', from: 420 * mul, to: 700 * mul, dur: 0.09, gain: 0.22 });
    },
    bump: function () { tone({ type: 'square', from: 150, to: 90, dur: 0.09, gain: 0.2 }); },
    blip: function () { tone({ type: 'square', from: 600, to: 900, dur: 0.07, gain: 0.2 }); },

    coin: function () {
      tone({ type: 'square', from: 880, to: 880, dur: 0.06, gain: 0.25 });
      tone({ type: 'square', from: 1320, to: 1320, dur: 0.1, gain: 0.25, delay: 0.06 });
    },

    splash: function () {
      noise({ dur: 0.45, freq: 1600, sweepTo: 200, gain: 0.4 });
      tone({ type: 'sine', from: 300, to: 80, dur: 0.35, gain: 0.2 });
    },

    squash: function () {
      noise({ dur: 0.3, freq: 500, sweepTo: 120, gain: 0.5 });
      tone({ type: 'sawtooth', from: 180, to: 50, dur: 0.3, gain: 0.3 });
    },

    horn: function () {
      tone({ type: 'sawtooth', from: 220, to: 210, dur: 0.5, gain: 0.22 });
      tone({ type: 'sawtooth', from: 165, to: 158, dur: 0.5, gain: 0.2 });
    },

    caught: function () {
      tone({ type: 'sawtooth', from: 300, to: 60, dur: 0.9, gain: 0.35 });
      noise({ dur: 0.9, freq: 700, sweepTo: 120, gain: 0.3 });
    },

    unlockChime: function () {
      [523, 659, 784, 1047].forEach(function (f, i) {
        tone({ type: 'triangle', from: f, to: f, dur: 0.16, gain: 0.28, delay: i * 0.08 });
      });
    },

    deny: function () { tone({ type: 'square', from: 200, to: 120, dur: 0.18, gain: 0.25 }); },

    /* A car shaving past. */
    whoosh: function () {
      noise({ dur: 0.16, filter: 'bandpass', freq: 900, sweepTo: 2600, gain: 0.3 });
    },

    /* An impatient driver. */
    beep: function () {
      tone({ type: 'square', from: 620, to: 620, dur: 0.06, gain: 0.2 });
      tone({ type: 'square', from: 620, to: 620, dur: 0.09, gain: 0.2, delay: 0.09 });
    },

    /* Tires announcing that a black car has found you... */
    screech: function () {
      noise({ dur: 0.55, filter: 'bandpass', freq: 2400, sweepTo: 900, gain: 0.3 });
      tone({ type: 'sawtooth', from: 1500, to: 800, dur: 0.45, gain: 0.12 });
    },

    /* ...its engine gunning across the lawn... */
    engine: function () {
      tone({ type: 'sawtooth', from: 90, to: 260, dur: 0.45, gain: 0.3 });
      noise({ dur: 0.45, filter: 'lowpass', freq: 700, sweepTo: 1300, gain: 0.2 });
    },

    /* ...and a door closing on the matter. */
    doorSlam: function () {
      noise({ dur: 0.14, filter: 'lowpass', freq: 900, sweepTo: 250, gain: 0.5 });
      tone({ type: 'sine', from: 160, to: 70, dur: 0.16, gain: 0.3 });
    },

    /* Ice: a light landing, a worrying creak, a full break. */
    iceLand: function () {
      tone({ type: 'triangle', from: 900, to: 700, dur: 0.06, gain: 0.14 });
    },
    iceCrack: function () {
      noise({ dur: 0.12, filter: 'highpass', freq: 2800, gain: 0.28 });
      tone({ type: 'square', from: 950, to: 480, dur: 0.1, gain: 0.14 });
    },
    iceBreak: function () {
      noise({ dur: 0.3, filter: 'lowpass', freq: 1600, sweepTo: 300, gain: 0.4 });
      tone({ type: 'sine', from: 350, to: 110, dur: 0.28, gain: 0.2 });
    },

    /* The lottery crate arriving from a considerate sky. */
    crateDrop: function () {
      tone({ type: 'sine', from: 220, to: 60, dur: 0.22, gain: 0.35 });
      noise({ dur: 0.22, filter: 'lowpass', freq: 500, sweepTo: 140, gain: 0.4 });
    },

    /* Through a sector gate: a proper little victory phrase. */
    fanfare: function () {
      [392, 523, 659, 784].forEach(function (f, i) {
        tone({ type: 'square', from: f, to: f, dur: i === 3 ? 0.3 : 0.12, gain: 0.24, delay: i * 0.09 });
      });
      tone({ type: 'triangle', from: 196, to: 196, dur: 0.5, gain: 0.2, delay: 0.27 });
    },

    milestone: function () {
      tone({ type: 'triangle', from: 660, to: 660, dur: 0.1, gain: 0.22 });
      tone({ type: 'triangle', from: 990, to: 990, dur: 0.14, gain: 0.22, delay: 0.1 });
    }
  };

  PP.Audio = Audio;
})(window);
