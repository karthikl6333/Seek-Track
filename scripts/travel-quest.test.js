import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HAZARD_GLYPHS, ITEM_GLYPHS, MOTIFS } from '../public/games/travel-quest/js/catalog.js';
import { CAST } from '../public/games/travel-quest/js/cast.js';
import { HAZARD_DRAW, ITEM_DRAW, LANDMARK_PLAN, MOTIF_DRAW } from '../public/games/travel-quest/js/draw.js';
import { bumpCombo, magnetPull, squashStretch } from '../public/games/travel-quest/js/feel.js';
import { createLayerCache } from '../public/games/travel-quest/js/layers.js';
import { COUNTRIES, LEVELS, levelById } from '../public/games/travel-quest/js/levels.js';
import {
  emptySave,
  isUnlocked,
  loadSave,
  migrateLegacy,
  normalizeSave,
  recordFinish,
  recordScore,
  starsFor,
  writeSave,
} from '../public/games/travel-quest/js/progress.js';
import {
  apexDelay,
  duckClearsHazard,
  fullAirtime,
  jumpClearsHazard,
  layoutFor,
  playerHitBox,
} from '../public/games/travel-quest/js/physics.js';
import { applyCheckpoint, biomeAt, boxesOverlap, buildRun, mulberry32, pickWeighted } from '../public/games/travel-quest/js/run.js';
import { checkpointOf, withCheckpoint } from '../public/games/travel-quest/js/progress.js';
import { validateCountryList, validateLevel, validateLevelList } from '../public/games/travel-quest/js/schema.js';
import template from '../public/games/travel-quest/levels/template.js';

const root = join(process.cwd(), 'public', 'games', 'travel-quest');

function walk(dir) {
  let files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files = files.concat(walk(path));
    else files.push(path);
  }
  return files;
}

describe('Travel Quest levels', () => {
  it('registers every country file except the template', () => {
    const files = readdirSync(join(root, 'levels')).filter((name) => name.endsWith('.js') && name !== 'template.js');
    const registry = readFileSync(join(root, 'js', 'levels.js'), 'utf8');
    expect(registry).not.toContain('template.js');
    for (const file of files) expect(registry).toContain(`../levels/${file}`);
    expect(COUNTRIES.map((country) => country.id).sort()).toEqual(files.map((file) => file.replace(/\.js$/, '')).sort());
    expect(LEVELS.map((level) => level.id)).toEqual([
      'bangkok',
      'chiang-mai',
      'phi-phi',
      'hanoi',
      'hoi-an',
      'halong',
      'downtown',
      'old-dubai',
      'desert',
    ]);
  });

  it('accepts the template and the live chain', () => {
    expect(validateLevel(template)).toEqual([]);
    expect(validateCountryList(COUNTRIES)).toEqual([]);
    expect(validateLevelList(LEVELS)).toEqual([]);
  });

  it('opens Bangkok and keeps later cities locked until the previous one is cleared', () => {
    const bangkok = levelById('bangkok');
    const hanoi = levelById('hanoi');
    const downtown = levelById('downtown');
    const fresh = emptySave();
    expect(isUnlocked(bangkok, fresh)).toBe(true);
    expect(isUnlocked(hanoi, fresh)).toBe(false);
    expect(isUnlocked(downtown, fresh)).toBe(false);
    const stamped = recordFinish(fresh, 'bangkok', 120, 1);
    expect(isUnlocked(levelById('chiang-mai'), stamped)).toBe(true);
    expect(isUnlocked(hanoi, stamped)).toBe(false);
    expect(stamped.levels.bangkok.stars).toBe(1);
    expect(recordFinish(stamped, 'bangkok', 40, 1).levels.bangkok.best).toBe(120);
  });

  it('gives every city a landmark and a steeper heat later on', () => {
    for (const level of LEVELS) {
      for (const biome of level.biomes) expect(LANDMARK_PLAN[biome.id]?.length).toBeGreaterThan(0);
    }
    expect(levelById('desert').heat).toBeGreaterThan(levelById('bangkok').heat);
    const audio = readFileSync(join(root, 'js', 'audio.js'), 'utf8');
    for (const level of LEVELS) expect(audio).toContain(`${level.music}:`);
  });

  it('draws every catalog glyph and motif', () => {
    for (const id of ITEM_GLYPHS) expect(typeof ITEM_DRAW[id]).toBe('function');
    for (const id of HAZARD_GLYPHS) expect(typeof HAZARD_DRAW[id]).toBe('function');
    for (const id of MOTIFS) expect(typeof MOTIF_DRAW[id]).toBe('function');
  });
});

describe('Travel Quest runs', () => {
  it('builds a fair course for several seeds', () => {
    for (const level of LEVELS) {
      expect(level.durationSec).toBeGreaterThanOrEqual(60);
      expect(level.durationSec).toBeLessThanOrEqual(90);
      for (const seed of [1, 2, 99, 12345]) {
        const run = buildRun(level, mulberry32(seed));
        expect(run.duration).toBe(level.durationSec);
        const finish = run.events.filter((event) => event.type === 'finish');
        expect(finish.map((event) => event.t)).toEqual([level.durationSec]);
        for (let i = 1; i < run.events.length; i += 1) {
          expect(run.events[i].t).toBeGreaterThanOrEqual(run.events[i - 1].t);
        }
        const hazards = run.events.filter((event) => event.type === 'hazard');
        const items = run.events.filter((event) => event.type === 'item');
        expect(hazards.length).toBeGreaterThan(5);
        expect(items.length).toBeGreaterThan(12);
        expect(hazards[0].t).toBeGreaterThanOrEqual(4);
        expect(hazards[hazards.length - 1].t).toBeLessThan(run.duration - 3);
        for (let i = 1; i < hazards.length; i += 1) {
          expect(hazards[i].t - hazards[i - 1].t).toBeGreaterThanOrEqual(1.8);
        }
        const facts = run.events.filter((event) => event.type === 'fact');
        expect(facts).toHaveLength(level.facts.length);
        for (const fact of facts) {
          for (const hazard of hazards) expect(Math.abs(hazard.t - fact.t)).toBeGreaterThanOrEqual(0.85);
        }
        for (const item of items) {
          expect(items[0] && item.spec.points).toBeGreaterThan(0);
          for (const hazard of hazards) expect(Math.abs(hazard.t - item.t)).toBeGreaterThanOrEqual(0.34);
        }
      }
    }
  });

  it('picks rare souvenirs less often', () => {
    const items = LEVELS[0].items;
    const counts = Object.fromEntries(items.map((item) => [item.id, 0]));
    const rand = mulberry32(7);
    for (let i = 0; i < 4000; i += 1) counts[pickWeighted(items, rand).id] += 1;
    const rare = items.find((item) => item.weight === 1);
    const common = items.find((item) => item.weight === 5);
    expect(counts[common.id]).toBeGreaterThan(counts[rare.id] * 3);
  });

  it('names a biome and blends into the next one', () => {
    const level = LEVELS[0];
    const start = biomeAt(level, 1);
    expect(start.showing.id).toBe(level.biomes[0].id);
    expect(start.blend).toBe(0);
    const late = biomeAt(level, level.durationSec - 1);
    expect(late.showing.id).toBe(level.biomes[level.biomes.length - 1].id);
    const boundary = level.biomes[0].share * level.durationSec - 0.2;
    const edge = biomeAt(level, boundary);
    expect(edge.blend).toBeGreaterThan(0);
    expect(edge.blend).toBeLessThanOrEqual(1);
  });

  it('clears every ground hurdle with a tap or a held jump', () => {
    const views = [
      [390, 700],
      [1280, 800],
      [1920, 1080],
    ];
    for (const level of LEVELS) {
      for (const seed of [1, 2, 99, 12345]) {
        const run = buildRun(level, mulberry32(seed));
        const hazards = run.events.filter((event) => event.type === 'hazard');
        expect(hazards.length).toBeGreaterThan(5);
        for (const [w, h] of views) {
          const layout = layoutFor(w, h);
          expect(hazards[1].t - hazards[0].t).toBeGreaterThan(fullAirtime(h, layout.ph) + 0.2);
          for (const hazard of hazards) {
            for (const person of CAST) {
              if (hazard.spec.lane === 'high') {
                expect(duckClearsHazard(layout, 'high', person.hit), `${person.id} duck`).toBe(true);
                continue;
              }
              for (const hold of [false, true]) {
                const lead = apexDelay(h, layout.ph, hold);
                for (const offset of [-0.1, 0, 0.08]) {
                  expect(
                    jumpClearsHazard(layout, hazard.spec.lane, { hold, lead: lead + offset, hitScale: person.hit }),
                    `${level.id} ${person.id} seed ${seed} ${hazard.spec.lane} hold ${hold} offset ${offset}`,
                  ).toBe(true);
                }
              }
            }
          }
        }
      }
    }
  });

  it('restores a run from the last checkpoint', () => {
    for (const level of LEVELS) {
      const run = buildRun(level, mulberry32(7));
      const flags = run.events.filter((event) => event.type === 'checkpoint');
      expect(flags.length).toBeGreaterThanOrEqual(2);
      expect(flags.length).toBeLessThanOrEqual(3);
      const flag = flags[0];
      const before = run.events.filter((event) => event.type === 'item' && event.t < flag.t - 0.05);
      const after = run.events.filter((event) => event.type === 'item' && event.t > flag.t + 0.2);
      expect(before.length).toBeGreaterThan(0);
      expect(after.length).toBeGreaterThan(0);
      applyCheckpoint(run.events, flag.t);
      expect(before.every((event) => event.dead)).toBe(true);
      expect(after.every((event) => event.dead)).toBe(false);
      const save = withCheckpoint(emptySave(), level.id, { time: flag.t, score: 80, seed: 7 });
      expect(checkpointOf(save, level.id)).toEqual({ time: flag.t, score: 80, seed: 7 });
      const again = buildRun(level, mulberry32(checkpointOf(save, level.id).seed));
      applyCheckpoint(again.events, checkpointOf(save, level.id).time);
      expect(again.events.filter((event) => event.type === 'item' && event.t < flag.t - 0.05).every((event) => event.dead)).toBe(true);
      expect(again.events.find((event) => event.type === 'finish').dead).toBeFalsy();
    }
  });

  it('overlaps boxes only when they touch', () => {
    expect(boxesOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 4, h: 4 })).toBe(true);
    expect(boxesOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 4, h: 4 })).toBe(false);
  });
});

describe('Travel Quest save', () => {
  it('scores stars from the ceiling and ignores a broken save', () => {
    expect(starsFor(44, 100)).toBe(1);
    expect(starsFor(45, 100)).toBe(2);
    expect(starsFor(72, 100)).toBe(3);
    const messy = normalizeSave({ mute: 1, levels: { thailand: { best: -5, stars: 9, cleared: 1 }, '../x': { best: 1 } } });
    expect(messy.mute).toBe(true);
    expect(messy.levels.thailand).toEqual({ best: 0, stars: 3, cleared: true });
    expect(messy.levels['../x']).toBeUndefined();
    expect(messy.character).toBe('');
    expect(normalizeSave({ character: 'mom' }).character).toBe('mom');
    expect(normalizeSave({ character: 'photo' }).character).toBe('');
  });

  it('turns an old country stamp into cleared cities', () => {
    const stamped = recordFinish(emptySave(), 'thailand', 120, 1);
    const migrated = migrateLegacy(stamped);
    expect(migrated.levels.thailand.cleared).toBe(true);
    expect(migrated.levels.bangkok).toEqual({ best: 120, stars: 1, cleared: true });
    expect(migrated.levels['chiang-mai'].cleared).toBe(true);
    expect(migrated.levels['phi-phi'].cleared).toBe(true);
    expect(migrated.levels['chiang-mai'].best).toBe(0);
    expect(isUnlocked(levelById('hanoi'), migrated)).toBe(true);
    expect(isUnlocked(levelById('downtown'), migrated)).toBe(false);
    const both = migrateLegacy(recordFinish(stamped, 'vietnam', 90, 2));
    expect(both.levels.halong.cleared).toBe(true);
    expect(isUnlocked(levelById('downtown'), both)).toBe(true);
    const scoreOnly = migrateLegacy(recordScore(emptySave(), 'thailand', 80));
    expect(scoreOnly.levels.bangkok.best).toBe(80);
    expect(scoreOnly.levels.bangkok.cleared).toBe(false);
    expect(isUnlocked(levelById('hanoi'), scoreOnly)).toBe(false);
    const already = migrateLegacy({
      ...stamped,
      levels: { ...stamped.levels, bangkok: { best: 10, stars: 1, cleared: true } },
    });
    expect(already.levels['phi-phi']).toBeUndefined();
  });

  it('keeps adult hit boxes the same width and only a little taller', () => {
    const layout = layoutFor(1280, 800);
    const explorer = playerHitBox(layout, 0, false, 1);
    for (const person of CAST) {
      const box = playerHitBox(layout, 0, false, person.hit);
      expect(box.w).toBe(explorer.w);
      expect(person.id === 'explorer' ? box.h : box.h).toBeGreaterThan(0);
      if (person.id !== 'explorer') {
        expect(box.h).toBeGreaterThan(explorer.h);
        expect(box.h / explorer.h).toBeLessThan(1.2);
      }
    }
    expect(CAST.map((person) => person.id)).toEqual(['explorer', 'dad', 'mom']);
  });

  it('keeps combo, squash, and the magnet off the score', () => {
    expect(bumpCombo(2, 1.6)).toBe(3);
    expect(bumpCombo(2, 1.61)).toBe(1);
    const land = squashStretch({ pose: 'run', vy: 0, ph: 100, land: 1 });
    expect(land.sx).toBeGreaterThan(1);
    expect(land.sy).toBeLessThan(1);
    expect(magnetPull(500, 0, 40).pop).toBe(1);
    expect(magnetPull(10, 0, 40).pop).toBeGreaterThan(1);
  });

  it('reuses a cached scenery tile', () => {
    const cache = createLayerCache({
      createElement() {
        return {
          width: 0,
          height: 0,
          getContext() {
            return { setTransform() {} };
          },
        };
      },
    });
    let paints = 0;
    const first = cache.get('sky', 20, 10, () => {
      paints += 1;
    }, 1);
    const second = cache.get('sky', 20, 10, () => {
      paints += 1;
    }, 1);
    expect(first).toBe(second);
    expect(paints).toBe(1);
  });

  it('keeps a failed run’s best score without stamping it', () => {
    const memory = new Map();
    const storage = {
      getItem: (key) => (memory.has(key) ? memory.get(key) : null),
      setItem: (key, value) => memory.set(key, String(value)),
    };
    let save = recordScore(emptySave(), 'thailand', 80);
    save = recordScore(save, 'thailand', 40);
    expect(save.levels.thailand).toEqual({ best: 80, stars: 0, cleared: false });
    expect(isUnlocked(LEVELS[1], save)).toBe(false);
    writeSave(save, storage);
    expect(loadSave(storage).levels.thailand.best).toBe(80);
  });
});

describe('Travel Quest is a public static page', () => {
  it('stays small, offline, and out of the index', () => {
    const files = walk(root);
    const bytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
    expect(bytes).toBeLessThan(2 * 1024 * 1024);
    const shipped = files.filter((file) => /\.(html|css|js)$/.test(file));
    for (const file of shipped) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/https?:\/\//);
      expect(text, file).not.toMatch(/console\./);
      expect(text, file).not.toMatch(/\bfetch\s*\(/);
    }
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    expect(html).toContain('noindex');
    expect(html).toContain('js/main.js');
    expect(html).toContain('<canvas');
    expect(html).toContain('screen-cast');
    const names = readdirSync(join(root, 'assets'));
    expect(names.some((name) => /parents|slideshow|candidate/i.test(name))).toBe(false);
    for (const name of ['dad-idle.png', 'dad-run.png', 'mom-idle.png', 'mom-run.png', 'explorer-idle.png', 'explorer-run.png']) {
      const size = statSync(join(root, 'assets', name)).size;
      expect(size, name).toBeGreaterThan(1000);
      expect(size, name).toBeLessThan(200 * 1024);
    }
  });

  it('matches the trips noindex rule for /games and does not move the auth gate', () => {
    const headers = readFileSync(join(process.cwd(), 'public', '_headers'), 'utf8');
    expect(headers).toMatch(/\/games\/\*\s+X-Robots-Tag:\s*noindex/);
    expect(headers).toMatch(/\/trips\/\*\s+X-Robots-Tag:\s*noindex/);
    const worker = readFileSync(join(process.cwd(), 'scripts', 'prepare-cf-pages.js'), 'utf8');
    expect(worker).toContain("url.pathname.startsWith('/games/')");
    expect(worker).toContain("url.pathname.startsWith('/trips/')");
    const apiAt = worker.indexOf("url.pathname.startsWith('/api/')");
    const privateAt = worker.indexOf('isPrivatePath(url.pathname)');
    const assetsAt = worker.indexOf('env.ASSETS.fetch(request)');
    expect(apiAt).toBeGreaterThan(0);
    expect(privateAt).toBeGreaterThan(apiAt);
    expect(assetsAt).toBeGreaterThan(privateAt);
  });

  it('links Games from the sidebar without adding a private view', () => {
    const sidebar = readFileSync(join(process.cwd(), 'src', 'app', 'Sidebar.tsx'), 'utf8');
    expect(sidebar).toContain('href="/games/travel-quest/"');
    expect(sidebar).toContain('>Games<');
    expect(sidebar).toContain('href="/trips/"');
    expect(sidebar).toContain('>Trips<');
    const nav = readFileSync(join(process.cwd(), 'src', 'app', 'nav.ts'), 'utf8');
    expect(nav).not.toContain('travel-quest');
  });
});

describe('public trips pages', () => {
  it('lists the three trips with relative links and noindex', () => {
    const html = readFileSync(join(process.cwd(), 'public', 'trips', 'index.html'), 'utf8');
    expect(html).toContain('noindex');
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('href="./hk-macau-2027/"');
    expect(html).toContain('href="./norway-finland-2027/"');
    expect(html).toContain('href="./seychelles-2027/"');
    expect(html).toContain('Hong Kong &amp; Macau family trip, 9–17 Jan 2027');
    expect(html).toContain("Ashok &amp; his wife's Arctic honeymoon: Norway + Finnish Lapland, 23–28 Feb 2027");
    expect(html).toContain("Ashok &amp; his wife's Seychelles honeymoon, 23–28 Feb 2027");
    expect(html).toContain('./norway-finland-2027/images/cover.jpg');
    expect(html).toContain('./seychelles-2027/images/cover.jpg');
  });

  it('publishes the Hong Kong brochure under 25 MiB, with noindex and no external scripts', () => {
    const file = join(process.cwd(), 'public', 'trips', 'hk-macau-2027', 'index.html');
    const page = readFileSync(file, 'utf8');
    expect(statSync(file).size).toBeLessThan(25 * 1024 * 1024);
    expect(page).toContain('name="robots" content="noindex, nofollow"');
    expect(page).not.toMatch(/<script[^>]+src=/i);
  });
});
