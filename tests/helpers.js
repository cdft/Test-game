/* Shared harness for the browser test suite.
 *
 * Every test loads the real game (index.html over file://) in headless
 * Chromium. Two things make runs reproducible:
 *
 *  - Math.random is replaced with a seeded generator before any game script
 *    runs, so the same seed always generates the same world.
 *  - With { manualClock: true }, requestAnimationFrame is captured and the
 *    test advances the game frame by frame with step(), instead of waiting on
 *    wall-clock time. Slow CI machines then see exactly the same simulation
 *    as a fast laptop.
 */
'use strict';

const path = require('path');
const { chromium } = require('playwright');

// GAME_URL can point the suite at another copy, e.g. the published site.
const GAME_URL = process.env.GAME_URL || ('file://' + path.resolve(__dirname, '..', 'index.html'));

let browserPromise = null;

function browser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      // Lets a sandbox point at a preinstalled build; CI uses Playwright's own.
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--autoplay-policy=no-user-gesture-required']
    });
  }
  return browserPromise;
}

async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise;
    browserPromise = null;
    await b.close();
  }
}

/* Runs in the page before any game script. */
function initScript(opts) {
  // mulberry32 — tiny, fast, good enough for level generation.
  let s = (opts.seed >>> 0) || 1;
  Math.random = function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  if (opts.freshSave) {
    try { localStorage.clear(); } catch (e) { /* file:// may refuse */ }
  }
  if (opts.save) {
    try { localStorage.setItem('pp.save', JSON.stringify(opts.save)); } catch (e) { /* ignore */ }
  }

  if (opts.manualClock) {
    const queue = [];
    let now = 1000;
    window.requestAnimationFrame = function (cb) { queue.push(cb); return queue.length; };
    window.__step = function (frames, dt) {
      dt = dt || 1000 / 60;
      for (let i = 0; i < frames; i++) {
        now += dt;
        const batch = queue.splice(0, queue.length);
        for (const cb of batch) cb(now);
      }
    };
  }
}

/**
 * Open the game. Returns { page, errors, step, eval, close }.
 *   seed         world seed (default 1)
 *   viewport     { width, height } (default phone-ish 390x844)
 *   manualClock  drive frames explicitly with step() (default true)
 *   freshSave    start with empty localStorage (default true)
 *   save         a save file to start from (written before the game boots)
 *   url          load this page instead of GAME_URL
 */
async function openGame(opts) {
  opts = Object.assign({ seed: 1, manualClock: true, freshSave: true, viewport: { width: 390, height: 844 } }, opts);
  const b = await browser();
  const context = await b.newContext({ viewport: opts.viewport, deviceScaleFactor: opts.dpr || 1, hasTouch: !!opts.hasTouch, isMobile: !!opts.isMobile });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.addInitScript(initScript, { seed: opts.seed, manualClock: opts.manualClock, freshSave: opts.freshSave, save: opts.save || null });
  await page.goto(opts.url || GAME_URL);
  // Interval polling: the default rAF polling never fires under manualClock.
  await page.waitForFunction(() => window.PP && window.PP.Game && window.PP.Render, null, { polling: 50 });

  async function step(frames, dt) {
    await page.evaluate(([f, d]) => window.__step(f, d), [frames, dt || 1000 / 60]);
  }

  /* Step until pred(PP) is true or the frame budget runs out. */
  async function stepUntil(predSrc, maxFrames) {
    for (let i = 0; i < (maxFrames || 600); i += 5) {
      if (await page.evaluate(new Function('return (' + predSrc + ')(window.PP)'))) return true;
      await step(5);
    }
    return false;
  }

  return {
    page,
    errors,
    step,
    stepUntil,
    eval: (fn, arg) => page.evaluate(fn, arg),
    close: () => context.close()
  };
}

module.exports = { openGame, browser, closeBrowser, GAME_URL };
