/* Sound: the band plays when you run, stops when you pause or mute, and every
 * effect in the sound bank can fire without an error. Runs on the real clock,
 * because WebAudio schedules against its own. */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openGame, closeBrowser } = require('./helpers');

test.after(closeBrowser);

test('the band strikes up when the run starts', async () => {
  const a = await openGame({ seed: 61, manualClock: false });
  await a.page.click('#btn-play');
  await a.page.waitForTimeout(300);
  const s = await a.eval(() => ({ ctx: PP.Audio.context() && PP.Audio.context().state, music: PP.Music.isPlaying() }));
  assert.equal(s.ctx, 'running');
  assert.equal(s.music, true);
  assert.deepEqual(a.errors, []);
  await a.close();
});

test('pause stops the music, resume brings it back', async () => {
  const a = await openGame({ seed: 62, manualClock: false });
  await a.page.click('#btn-play');
  await a.page.waitForTimeout(200);
  await a.page.click('#btn-pause');
  assert.equal(await a.eval(() => PP.Music.isPlaying()), false);
  await a.page.click('#btn-resume');
  assert.equal(await a.eval(() => PP.Music.isPlaying()), true);
  await a.close();
});

test('mute silences everything and is remembered', async () => {
  const a = await openGame({ seed: 63, manualClock: false });
  await a.page.click('#btn-play');
  await a.page.waitForTimeout(200);
  await a.page.keyboard.press('m');
  const s = await a.eval(() => ({
    muted: PP.Audio.isMuted(), music: PP.Music.isPlaying(),
    icon: document.getElementById('btn-mute').textContent,
    stored: localStorage.getItem('pp.muted')
  }));
  assert.equal(s.muted, true);
  assert.equal(s.music, false);
  assert.equal(s.icon, '🔇');
  assert.equal(s.stored, 'true');
  await a.page.keyboard.press('m');
  assert.equal(await a.eval(() => PP.Music.isPlaying()), true, 'unmuting mid-run brings the band back');
  await a.close();
});

test('every sound in the bank plays without error', async () => {
  const a = await openGame({ seed: 64, manualClock: false });
  await a.page.click('#btn-play');
  const failed = await a.eval(() => {
    const skip = ['isMuted', 'context', 'destination', 'toggleMute', 'unlock'];
    const out = [];
    for (const k of Object.keys(PP.Audio)) {
      if (skip.includes(k) || typeof PP.Audio[k] !== 'function') continue;
      try { PP.Audio[k](1); } catch (e) { out.push(k + ': ' + e.message); }
    }
    try { PP.Music.setUrgent(true); PP.Music.victoryOfTheCollective(); PP.Music.fadeOut(0.3); } catch (e) { out.push('music: ' + e.message); }
    return out;
  });
  await a.page.waitForTimeout(800);
  assert.deepEqual(failed, []);
  assert.deepEqual(a.errors, []);
  await a.close();
});

test('sounds asked for before the first tap are dropped, not saved up', async () => {
  const a = await openGame({ seed: 65, manualClock: false });
  const made = await a.eval(() => {
    let n = 0;
    const AC = window.AudioContext;
    const real = AC.prototype.createOscillator;
    AC.prototype.createOscillator = function () { n++; return real.call(this); };
    // The title screen's trains honk while nobody has touched anything.
    for (let i = 0; i < 5; i++) PP.Audio.horn();
    return n;
  });
  assert.equal(made, 0);
  await a.close();
});

test('being caught cuts the march dead under the victory cadence', async () => {
  const a = await openGame({ seed: 66, manualClock: false });
  await a.page.click('#btn-play');
  await a.page.waitForTimeout(600);
  const s = await a.eval(() => {
    const g = PP.Game.g;
    g.tide.row = g.player.row;   // the Collective arrives
    return new Promise(r => setTimeout(() => r({ music: PP.Music.isPlaying(), mode: PP.Game.mode() }), 200));
  });
  assert.deepEqual(s, { music: false, mode: 'dying' });
  assert.deepEqual(a.errors, []);
  await a.close();
});
