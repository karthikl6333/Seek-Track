import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HAZARD_GLYPHS, ITEM_GLYPHS, MOTIFS } from '../public/games/travel-quest/js/catalog.js';
import { HAZARD_DRAW, ITEM_DRAW, MOTIF_DRAW } from '../public/games/travel-quest/js/draw.js';
import { LEVELS } from '../public/games/travel-quest/js/levels.js';
import {
  emptySave,
  isUnlocked,
  loadSave,
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
} from '../public/games/travel-quest/js/physics.js';
import { applyCheckpoint, biomeAt, boxesOverlap, buildRun, mulberry32, pickWeighted } from '../public/games/travel-quest/js/run.js';
import { checkpointOf, withCheckpoint } from '../public/games/travel-quest/js/progress.js';
import { validateLevel, validateLevelList } from '../public/games/travel-quest/js/schema.js';
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
    expect(LEVELS.map((level) => level.id).sort()).toEqual(files.map((file) => file.replace(/\.js$/, '')).sort());
  });

  it('accepts the template and the live chain', () => {
    expect(validateLevel(template)).toEqual([]);
    expect(validateLevelList(LEVELS)).toEqual([]);
  });

  it('Thailand is open and Vietnam waits for that stamp', () => {
    const [thailand, vietnam] = LEVELS;
    expect(thailand.id).toBe('thailand');
    expect(vietnam.id).toBe('vietnam');
    expect(vietnam.requires).toBe('thailand');
    const fresh = emptySave();
    expect(isUnlocked(thailand, fresh)).toBe(true);
    expect(isUnlocked(vietnam, fresh)).toBe(false);
    const stamped = recordFinish(fresh, 'thailand', 120, 1);
    expect(isUnlocked(vietnam, stamped)).toBe(true);
    expect(stamped.levels.thailand.stars).toBe(1);
    expect(recordFinish(stamped, 'thailand', 40, 1).levels.thailand.best).toBe(120);
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
            if (hazard.spec.lane === 'high') {
              expect(duckClearsHazard(layout, 'high')).toBe(true);
              continue;
            }
            for (const hold of [false, true]) {
              const lead = apexDelay(h, layout.ph, hold);
              for (const offset of [-0.1, 0, 0.08]) {
                expect(
                  jumpClearsHazard(layout, hazard.spec.lane, { hold, lead: lead + offset }),
                  `${level.id} seed ${seed} ${hazard.spec.lane} hold ${hold} offset ${offset}`,
                ).toBe(true);
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
  });

  it('matches the trips noindex rule for /games and does not move the auth gate', () => {
    const headers = readFileSync(join(process.cwd(), 'public', '_headers'), 'utf8');
    expect(headers).toMatch(/\/games\/\*\s+X-Robots-Tag:\s*noindex/);
    const worker = readFileSync(join(process.cwd(), 'scripts', 'prepare-cf-pages.js'), 'utf8');
    expect(worker).toContain("url.pathname.startsWith('/games/')");
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
    const nav = readFileSync(join(process.cwd(), 'src', 'app', 'nav.ts'), 'utf8');
    expect(nav).not.toContain('travel-quest');
  });
});
