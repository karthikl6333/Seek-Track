/**
 * Browser smoke for the checkpoint chime and respawn.
 * Run with Playwright installed (WebKit + Chromium):
 *   PLAYWRIGHT_MODULE=playwright node scripts/travel-quest-checkpoint-smoke.mjs
 * Expects the static site at TQ_ORIGIN (default http://127.0.0.1:8765).
 * Set TQ_SHOT to a png path to save the Phi Phi checkpoint frame.
 */
import { LEVELS } from '../public/games/travel-quest/js/levels.js';

const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium, devices, webkit } = playwright;
import { buildRun, mulberry32 } from '../public/games/travel-quest/js/run.js';

const origin = process.env.TQ_ORIGIN || 'http://127.0.0.1:8765';
const characters = ['explorer', 'dad', 'mom'];
const seed = 11;

function firstFlag(level) {
  const run = buildRun(level, mulberry32(seed));
  const flag = run.events.find((event) => event.type === 'checkpoint');
  if (!flag) throw new Error(`${level.id} has no checkpoint`);
  return flag;
}

function saveFor(character, extra) {
  const levels = {};
  for (const level of LEVELS) levels[level.id] = { best: 10, stars: 1, cleared: true };
  if (extra) Object.assign(levels, extra);
  return JSON.stringify({ v: 1, mute: false, helpSeen: true, character, levels });
}

async function open(page, path, raw) {
  await page.goto(`${origin}/games/travel-quest/`);
  await page.evaluate((value) => localStorage.setItem('seektrack.travelQuest.v1', value), raw);
  await page.goto(`${origin}/games/travel-quest/${path}`);
}

async function readState(page) {
  return page.evaluate(() => {
    const progress = document.getElementById('progress');
    const fatal = document.getElementById('fatal');
    const hud = document.getElementById('hud');
    return {
      fatalHidden: fatal ? fatal.hidden : null,
      fatalText: document.getElementById('fatal-text')?.textContent || '',
      hudHidden: hud ? hud.hidden : null,
      reached: document.querySelectorAll('#marks .cp-mark.reached').length,
      width: progress ? parseFloat(progress.style.width) || 0 : 0,
      live: document.getElementById('live')?.textContent || '',
      toast: document.getElementById('toast')?.textContent || '',
    };
  });
}

async function reachCheckpoint(page, level, character, shot) {
  const flag = firstFlag(level);
  const at = Math.max(0, flag.t - 1.2);
  await open(page, `?level=${encodeURIComponent(level.id)}&at=${at}`, saveFor(character));
  await page.mouse.click(180, 420);
  await page.waitForFunction(
    () => document.querySelectorAll('#marks .cp-mark.reached').length >= 1,
    null,
    { timeout: 6000 },
  );
  if (shot) await page.screenshot({ path: shot });
  const first = await readState(page);
  await page.waitForTimeout(1800);
  const second = await readState(page);
  return { first, second, flag };
}

async function respawn(page, level, character) {
  const flag = firstFlag(level);
  const raw = saveFor(character, {
    [level.id]: { best: 10, stars: 1, cleared: true, checkpoint: { time: flag.t, score: 40, seed } },
  });
  await open(page, `?level=${encodeURIComponent(level.id)}`, raw);
  await page.waitForFunction(() => !document.getElementById('hud').hidden, null, { timeout: 6000 });
  await page.keyboard.press('r');
  await page.waitForTimeout(350);
  const state = await readState(page);
  return { state, flag, expected: (flag.t / level.durationSec) * 100 };
}

async function legacy(page) {
  const raw = JSON.stringify({
    v: 1,
    mute: false,
    helpSeen: true,
    character: 'explorer',
    levels: {
      thailand: { best: 0, stars: 0, cleared: false, checkpoint: { time: 48, score: 20, seed: 9 } },
    },
  });
  await open(page, '?level=bangkok', raw);
  await page.waitForFunction(() => !document.getElementById('hud').hidden, null, { timeout: 6000 });
  await page.keyboard.press('r');
  await page.waitForTimeout(400);
  const state = await readState(page);
  const stored = await page.evaluate(() => localStorage.getItem('seektrack.travelQuest.v1'));
  return { state, stored: stored ? JSON.parse(stored) : null };
}

function checkReach(label, result, failures) {
  const { first, second } = result;
  if (!first.fatalHidden) failures.push(`${label} reach showed the overlay: ${first.fatalText}`);
  if (first.hudHidden) failures.push(`${label} reach hid the hud`);
  if (first.reached < 1) failures.push(`${label} reach never passed a flag`);
  if (!(second.width > first.width)) failures.push(`${label} reach stopped after the flag (${first.width} -> ${second.width})`);
}

function checkRespawn(label, result, failures) {
  const { state, expected } = result;
  if (!state.fatalHidden) failures.push(`${label} respawn showed the overlay: ${state.fatalText}`);
  if (Math.abs(state.width - expected) > 8) {
    failures.push(`${label} respawn progress ${state.width} was not near ${expected.toFixed(1)}`);
  }
}

async function runBrowser(name, browserType, contextOptions, shotPath) {
  const failures = [];
  const browser = await browserType.launch();
  const context = await browser.newContext(contextOptions);
  await context.addInitScript(() => {
    const proto = window.AudioParam && window.AudioParam.prototype;
    if (!proto) return;
    proto.exponentialRampToValueAtTime = function ramp() {
      throw new DOMException('The string did not match the expected pattern.', 'SyntaxError');
    };
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(`${err.name}: ${err.message}`));
  let shot = shotPath;
  for (const character of characters) {
    for (const level of LEVELS) {
      const label = `${name} ${character} ${level.id}`;
      try {
        const takeShot = shot && level.id === 'phi-phi' && character === 'explorer' ? shot : '';
        const reached = await reachCheckpoint(page, level, character, takeShot);
        if (takeShot) shot = '';
        checkReach(label, reached, failures);
        const again = await respawn(page, level, character);
        checkRespawn(label, again, failures);
      } catch (err) {
        failures.push(`${label} ${err.message}`);
      }
    }
  }
  try {
    const old = await legacy(page);
    if (!old.state.fatalHidden) failures.push(`${name} legacy overlay: ${old.state.fatalText}`);
    if (old.state.width > 8) failures.push(`${name} legacy country flag resumed Bangkok at ${old.state.width}%`);
    if (old.stored && old.stored.levels && old.stored.levels.thailand && old.stored.levels.thailand.checkpoint) {
      failures.push(`${name} legacy country checkpoint was kept`);
    }
  } catch (err) {
    failures.push(`${name} legacy ${err.message}`);
  }
  try {
    const escaped = await context.newPage();
    await escaped.addInitScript(() => {
      const proto = window.AudioParam && window.AudioParam.prototype;
      if (!proto) return;
      proto.setValueAtTime = function () {
        throw new DOMException('The string did not match the expected pattern.', 'SyntaxError');
      };
      window.__notes = [];
      const watch = () => {
        const live = document.getElementById('live');
        if (!live) return;
        new MutationObserver(() => window.__notes.push(live.textContent)).observe(live, {
          subtree: true,
          characterData: true,
          childList: true,
        });
      };
      document.addEventListener('DOMContentLoaded', watch);
    });
    const level = LEVELS.find((item) => item.id === 'phi-phi');
    const flag = firstFlag(level);
    await open(escaped, `?level=phi-phi&at=${Math.max(0, flag.t - 1.2)}`, saveFor('explorer'));
    await escaped.mouse.click(180, 420);
    await escaped.waitForFunction(
      () => document.querySelectorAll('#marks .cp-mark.reached').length >= 1,
      null,
      { timeout: 6000 },
    );
    const atFlag = await readState(escaped);
    await escaped.waitForTimeout(1800);
    const state = await readState(escaped);
    const notes = await escaped.evaluate(() => window.__notes || []);
    if (!state.fatalHidden) failures.push(`${name} escaped error still blocked play: ${state.fatalText}`);
    if (!notes.some((text) => String(text).includes('expected pattern'))) {
      failures.push(`${name} escaped error was not logged (${notes.join(' / ')})`);
    }
    if (!(state.width > atFlag.width)) failures.push(`${name} escaped error froze the run (${atFlag.width} -> ${state.width})`);
  } catch (err) {
    failures.push(`${name} escaped ${err.message}`);
  }
  if (pageErrors.length) failures.push(`${name} page errors: ${pageErrors.join(' | ')}`);
  await browser.close();
  return failures;
}

const iPhone = devices['iPhone 13'];
const failures = [];
failures.push(
  ...(await runBrowser('webkit-iphone', webkit, { ...iPhone }, process.env.TQ_SHOT || '')),
);
failures.push(
  ...(await runBrowser('chromium', chromium, { viewport: { width: 1280, height: 800 } }, '')),
);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`checkpoint smoke passed: ${characters.length * LEVELS.length} runs on WebKit iPhone and Chromium`);
