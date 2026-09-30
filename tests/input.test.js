/* Controls and screens on real device shapes: taps, swipes, two thumbs,
 * the keyboard, and menus that fit the phone they are on. */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openGame, closeBrowser } = require('./helpers');

test.after(closeBrowser);

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, dpr: 3 };

/* Record every move the game is asked to make. */
async function spyMoves(a) {
  await a.eval(() => {
    window.__moves = [];
    const real = PP.Game.move;
    PP.Game.move = function (dir) { window.__moves.push(dir); return real(dir); };
  });
}

async function startOnGrass(a) {
  await a.page.click('#btn-play');
  await a.step(2);
  await a.eval(() => {
    for (let i = 0; i <= 8; i++) PP.World.rows[i] = { index: i, type: 'grass', decor: [], blocked: {}, coin: null };
  });
  await spyMoves(a);
}

async function touch(cdp, type, points) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
}

test('a tap anywhere, even low on the screen, hops forward', async () => {
  const a = await openGame(Object.assign({ seed: 71 }, PHONE));
  await startOnGrass(a);
  for (const [x, y] of [[195, 800], [40, 700], [350, 780], [195, 200]]) {
    await a.page.touchscreen.tap(x, y);
    await a.step(12);
  }
  assert.deepEqual(await a.eval(() => window.__moves), ['up', 'up', 'up', 'up']);
  assert.equal(await a.eval(() => PP.Game.g.player.row), 6);
  await a.close();
});

test('swipes still steer: left, right and back', async () => {
  const a = await openGame(Object.assign({ seed: 72 }, PHONE));
  await startOnGrass(a);
  const cdp = await a.page.context().newCDPSession(a.page);
  for (const [dx, dy] of [[-80, 0], [80, 0], [0, 80]]) {
    await touch(cdp, 'touchStart', [{ x: 195, y: 500, id: 1 }]);
    await touch(cdp, 'touchMove', [{ x: 195 + dx, y: 500 + dy, id: 1 }]);
    await touch(cdp, 'touchEnd', []);
    await a.step(12);
  }
  assert.deepEqual(await a.eval(() => window.__moves), ['left', 'right', 'down']);
  await a.close();
});

test('a resting thumb does not turn another thumb\'s tap into a phantom swipe', async () => {
  const a = await openGame(Object.assign({ seed: 73 }, PHONE));
  await startOnGrass(a);
  const cdp = await a.page.context().newCDPSession(a.page);
  // Thumb 1 rests low-left; thumb 2 taps; thumb 1 jitters by a pixel.
  await touch(cdp, 'touchStart', [{ x: 90, y: 760, id: 1 }]);
  await touch(cdp, 'touchStart', [{ x: 90, y: 760, id: 1 }, { x: 300, y: 760, id: 2 }]);
  await touch(cdp, 'touchMove', [{ x: 91, y: 761, id: 1 }, { x: 300, y: 760, id: 2 }]);
  await touch(cdp, 'touchEnd', [{ x: 91, y: 761, id: 1 }]);
  await a.step(12);
  await touch(cdp, 'touchEnd', []);
  await a.step(12);
  // Two taps, two forward hops, no sideways hop.
  assert.deepEqual(await a.eval(() => window.__moves), ['up', 'up']);
  await a.close();
});

test('Enter and Space on a focused button press that button', async () => {
  const a = await openGame({ seed: 74, viewport: { width: 1000, height: 800 } });
  await a.page.focus('#btn-help');
  await a.page.keyboard.press('Enter');
  assert.equal(await a.eval(() => PP.Game.mode()), 'menu');
  assert.equal(await a.eval(() => document.getElementById('screen-help').classList.contains('hidden')), false);
  await a.page.focus('#btn-help-back');
  await a.page.keyboard.press('Space');
  await a.page.focus('#btn-pick');
  await a.page.keyboard.press('Space');
  assert.equal(await a.eval(() => document.getElementById('screen-pick').classList.contains('hidden')), false);
  assert.equal(await a.eval(() => PP.Game.mode()), 'menu');
  await a.close();
});

test('arrow keys do not start a run from behind the Help screen', async () => {
  const a = await openGame({ seed: 75, viewport: { width: 1000, height: 800 } });
  await a.page.click('#btn-help');
  await a.page.keyboard.press('ArrowUp');
  await a.page.keyboard.press('KeyW');
  assert.equal(await a.eval(() => PP.Game.mode()), 'menu');
  await a.page.click('#btn-help-back');
  await a.page.keyboard.press('ArrowUp');
  assert.equal(await a.eval(() => PP.Game.mode()), 'playing', 'but from the title they do');
  await a.close();
});

test('the pause card keeps Resume and Give up apart', async () => {
  const a = await openGame(Object.assign({ seed: 76 }, PHONE));
  await a.page.click('#btn-play');
  await a.step(2);
  await a.page.click('#btn-pause');
  const gap = await a.eval(() => {
    const r = document.getElementById('btn-resume').getBoundingClientRect();
    const q = document.getElementById('btn-quit').getBoundingClientRect();
    return q.top - r.bottom;
  });
  assert.ok(gap >= 12, `only ${gap}px between Resume and Give up`);
  await a.close();
});

const SMALL_SCREENS = [
  { name: 'iPhone SE (Safari chrome)', width: 375, height: 548 },
  { name: 'iPhone SE 1st gen', width: 320, height: 568 },
  { name: 'phone landscape', width: 750, height: 340 },
  { name: 'small landscape', width: 640, height: 360 }
];

for (const vp of SMALL_SCREENS) {
  test(`${vp.name}: every menu can be scrolled fully into view`, async () => {
    const a = await openGame({ seed: 77, viewport: { width: vp.width, height: vp.height }, hasTouch: true, isMobile: true });
    for (const [open, id] of [[null, 'screen-title'], ['#btn-help', 'screen-help'], ['#btn-help-back', null], ['#btn-pick', 'screen-pick']]) {
      if (open) await a.page.click(open);
      if (!id) continue;
      const top = await a.eval((sid) => {
        const scr = document.getElementById(sid);
        scr.scrollTop = 0;
        return scr.querySelector('.panel').getBoundingClientRect().top;
      }, id);
      assert.ok(top >= 0, `${id}: panel top is ${top}px, above the reachable area`);
    }
    await a.close();
  });
}

test('the title card fits a landscape phone without scrolling', async () => {
  const a = await openGame({ seed: 78, viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const fit = await a.eval(() => {
    const p = document.querySelector('#screen-title .panel').getBoundingClientRect();
    const play = document.getElementById('btn-play').getBoundingClientRect();
    return { top: p.top, playBottom: play.bottom, h: innerHeight };
  });
  assert.ok(fit.top >= 0 && fit.playBottom <= fit.h, JSON.stringify(fit));
  await a.close();
});

test('touch players are shown touch controls, keyboard players keys', async () => {
  const phone = await openGame(Object.assign({ seed: 79 }, PHONE));
  await phone.page.click('#btn-help');
  const p = await phone.eval(() => ({
    touch: getComputedStyle(document.querySelector('#screen-help .ctl-touch')).display,
    keys: getComputedStyle(document.querySelector('#screen-help .ctl-keys')).display
  }));
  assert.deepEqual(p, { touch: 'block', keys: 'none' });
  await phone.close();

  const desk = await openGame({ seed: 79, viewport: { width: 1200, height: 800 } });
  await desk.page.click('#btn-help');
  const d = await desk.eval(() => ({
    touch: getComputedStyle(document.querySelector('#screen-help .ctl-touch')).display,
    keys: getComputedStyle(document.querySelector('#screen-help .ctl-keys')).display
  }));
  assert.deepEqual(d, { touch: 'none', keys: 'flex' });
  await desk.close();
});

test('after clicking a HUD icon, Space and Enter do not press it again mid-run', async () => {
  const a = await openGame({ seed: 80, viewport: { width: 1280, height: 720 } });
  await a.page.click('#btn-play');
  await a.step(2);
  await a.page.click('#btn-mute');
  assert.equal(await a.eval(() => PP.Audio.isMuted()), true);
  await a.page.keyboard.press('Space');
  await a.page.keyboard.press('Enter');
  assert.equal(await a.eval(() => PP.Audio.isMuted()), true, 'Space/Enter toggled mute');
  await a.page.click('#btn-pause');
  await a.page.keyboard.press('p');
  await a.step(2);
  await a.page.keyboard.press('Space');
  await a.step(2);
  assert.equal(await a.eval(() => PP.Game.mode()), 'playing', 'Space paused the run');
  await a.close();
});

test('a half-confirmed "give up" is forgotten when you resume', async () => {
  const a = await openGame(Object.assign({ seed: 81 }, PHONE));
  await a.page.click('#btn-play');
  await a.step(2);
  await a.page.click('#btn-pause');
  await a.page.click('#btn-quit');
  await a.page.click('#btn-resume');
  await a.step(10);
  await a.page.click('#btn-pause');
  await a.page.click('#btn-quit');
  assert.equal(await a.eval(() => PP.Game.mode()), 'paused', 'one tap after a resume must only arm it');
  await a.close();
});

test('holding Enter on "give up" does not click it twice', async () => {
  const a = await openGame({ seed: 82, viewport: { width: 1280, height: 720 } });
  await a.page.click('#btn-play');
  await a.step(2);
  await a.page.keyboard.press('Escape');
  await a.page.focus('#btn-quit');
  // A second keydown without a keyup is an auto-repeat, as when a key is held.
  await a.page.keyboard.down('Enter');
  await a.page.keyboard.down('Enter');
  await a.page.keyboard.down('Enter');
  await a.page.keyboard.up('Enter');
  assert.equal(await a.eval(() => PP.Game.mode()), 'paused');
  await a.close();
});
