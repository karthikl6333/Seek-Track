/**
 * Builds one fair run from a level file. Same seed → same souvenirs and obstacles.
 * Times are in seconds. An entity's time is the moment it reaches the traveller.
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickWeighted(items, rand) {
  let total = 0;
  for (const item of items) total += item.weight;
  let roll = rand() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * @param {object} level
 * @param {() => number} rand
 * @returns {{ events: object[], scenery: object[], duration: number }}
 */
export function buildRun(level, rand) {
  const duration = level.durationSec;
  const events = [];
  for (const fact of level.facts) {
    events.push({ t: round2(fact.at * duration), type: 'fact', fact, dead: false });
  }

  let biomeStart = 0;
  for (const biome of level.biomes) {
    const biomeEnd = biomeStart + biome.share * duration;
    const first = biomeStart < 0.01;
    let t = biomeStart + (first ? 4.3 : 1.7);
    const stop = Math.min(biomeEnd - 0.7, duration - 3.3);
    let guard = 0;
    while (t < stop && guard < 500) {
      guard += 1;
      const roll = rand();
      if (roll < 0.26) {
        const spec = level.hazards[Math.floor(rand() * level.hazards.length)];
        events.push({ t: round2(t), type: 'hazard', spec, biomeId: biome.id, dead: false });
        t += 1.7 + rand() * 0.65;
      } else if (roll < 0.9) {
        const spec = pickWeighted(level.items, rand);
        // Most souvenirs sit on the road. A few float, so a jump is a bonus rather than a tax.
        const lane = rand() < 0.78 ? 'ground' : 'air';
        events.push({ t: round2(t), type: 'item', spec, lane, biomeId: biome.id, dead: false });
        t += 0.48 + rand() * 0.26;
      } else {
        const spec = pickWeighted(level.items, rand);
        const base = t;
        for (let i = 0; i < 3; i += 1) {
          events.push({
            t: round2(base + i * 0.26),
            type: 'item',
            spec,
            lane: 'air',
            biomeId: biome.id,
            dead: false,
          });
        }
        t += 1.6 + rand() * 0.35;
      }
    }
    biomeStart = biomeEnd;
  }
  events.push({ t: duration, type: 'finish', dead: false });

  const scenery = buildScenery(level, duration, rand);
  return { events: cleanup(events, duration), scenery, duration };
}

function cleanup(events, duration) {
  events.sort((a, b) => a.t - b.t);
  const facts = events.filter((event) => event.type === 'fact').map((event) => event.t);
  let lastHazard = -999;
  const kept = [];
  for (const event of events) {
    if (event.type !== 'hazard') {
      kept.push(event);
      continue;
    }
    let t = Math.max(event.t, lastHazard + 1.55, 4);
    if (t > duration - 3.15) continue;
    if (facts.some((factTime) => Math.abs(factTime - t) < 0.9)) continue;
    event.t = round2(t);
    lastHazard = event.t;
    kept.push(event);
  }
  const hazards = kept.filter((event) => event.type === 'hazard');
  return kept
    .filter((event) => {
      if (event.type !== 'item') return true;
      return !hazards.some((hazard) => Math.abs(hazard.t - event.t) < 0.34);
    })
    .sort((a, b) => a.t - b.t);
}

function buildScenery(level, duration, rand) {
  const props = [];
  let start = 0;
  for (const biome of level.biomes) {
    const end = start + biome.share * duration;
    let t = start - 1.2;
    while (t < end + 1.2) {
      props.push({
        t: round2(t),
        layer: 'far',
        motif: biome.far,
        variant: rand(),
        scale: round2(0.85 + rand() * 0.45),
        night: Boolean(biome.night),
        water: Boolean(biome.water),
      });
      t += 1.25 + rand() * 0.85;
    }
    t = start - 0.4;
    while (t < end + 1.2) {
      props.push({
        t: round2(t),
        layer: 'mid',
        motif: biome.mid,
        variant: rand(),
        scale: round2(0.75 + rand() * 0.4),
        night: Boolean(biome.night),
        water: Boolean(biome.water),
      });
      t += 1.7 + rand() * 1.05;
    }
    start = end;
  }
  return props;
}

export function boxesOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Which biome is on screen, plus a 0–1 blend into the next one near the boundary. */
export function biomeAt(level, time) {
  const duration = level.durationSec;
  const spans = [];
  let cursor = 0;
  for (const biome of level.biomes) {
    const end = cursor + biome.share * duration;
    spans.push({ biome, start: cursor, end });
    cursor = end;
  }
  let index = spans.findIndex((span) => time < span.end);
  if (index < 0) index = spans.length - 1;
  const current = spans[index];
  const upcoming = spans[index + 1] || null;
  let blend = 0;
  if (upcoming && current.end - time < 1.2) blend = 1 - (current.end - time) / 1.2;
  if (blend < 0) blend = 0;
  if (blend > 1) blend = 1;
  const showing = blend > 0.55 && upcoming ? upcoming.biome : current.biome;
  return { current: current.biome, next: upcoming ? upcoming.biome : null, blend, showing };
}
