/**
 * Checks a level file the same way the test suite does, and again when the
 * game boots, so a new country with a typo shows a message instead of a blank canvas.
 */
import { HAZARD_GLYPHS, ITEM_GLYPHS, ITEM_LANES, LANES, MOTIFS } from './catalog.js';

const ID_RE = /^[a-z0-9-]{1,40}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function has(list, id) {
  return list.indexOf(id) !== -1;
}

/** @returns {string[]} human-readable problems. Empty means the level is safe to play. */
export function validateLevel(level) {
  const errors = [];
  const where = level && level.id ? level.id : '(level)';
  const err = (msg) => errors.push(`${where}: ${msg}`);
  if (!level || typeof level !== 'object') return ['Level is missing.'];
  if (!ID_RE.test(level.id || '')) err('id must be 1–40 lowercase letters, numbers, or dashes');
  if (typeof level.title !== 'string' || level.title.length < 2) err('title is required');
  if (typeof level.blurb !== 'string' || level.blurb.length < 4) err('blurb is required');
  if (!Number.isInteger(level.order) || level.order < 1) err('order must be a positive integer');
  if (level.requires != null && !ID_RE.test(level.requires)) err('requires must be null or a level id');
  if (typeof level.durationSec !== 'number' || level.durationSec < 60 || level.durationSec > 90) {
    err('durationSec must be between 60 and 90');
  }
  if (typeof level.heartBonus !== 'number' || level.heartBonus < 0 || level.heartBonus > 500) {
    err('heartBonus must be a number from 0 to 500');
  }
  if (!HEX_RE.test(level.accent || '')) err('accent must be a #rrggbb color');
  if (!Array.isArray(level.biomes) || level.biomes.length < 2) err('needs at least two biomes');
  else {
    let share = 0;
    const seen = new Set();
    for (const biome of level.biomes) {
      if (!biome || !ID_RE.test(biome.id || '')) {
        err('each biome needs an id');
        continue;
      }
      if (seen.has(biome.id)) err(`duplicate biome ${biome.id}`);
      seen.add(biome.id);
      if (typeof biome.name !== 'string' || biome.name.length < 2) err(`${biome.id} needs a name`);
      if (typeof biome.share !== 'number' || biome.share <= 0.05) err(`${biome.id} share must be more than 0.05`);
      share += biome.share || 0;
      if (!Array.isArray(biome.sky) || biome.sky.length !== 2 || !biome.sky.every((c) => HEX_RE.test(c))) {
        err(`${biome.id} sky must be two #rrggbb colors`);
      }
      if (!HEX_RE.test(biome.ground || '') || !HEX_RE.test(biome.groundTop || '') || !HEX_RE.test(biome.hill || '')) {
        err(`${biome.id} needs ground, groundTop, and hill colors`);
      }
      if (!has(MOTIFS, biome.far)) err(`${biome.id} far motif "${biome.far}" is not in the catalog`);
      if (!has(MOTIFS, biome.mid)) err(`${biome.id} mid motif "${biome.mid}" is not in the catalog`);
    }
    if (Math.abs(share - 1) > 0.011) err(`biome shares must add up to 1 (got ${share.toFixed(3)})`);
  }

  if (!Array.isArray(level.items) || level.items.length < 2) err('needs at least two collectibles');
  else {
    for (const item of level.items) {
      if (!item || !ID_RE.test(item.id || '')) err('each collectible needs an id');
      else {
        if (typeof item.name !== 'string' || item.name.length < 2) err(`${item.id} needs a name`);
        if (!Number.isInteger(item.points) || item.points < 1) err(`${item.id} points must be a positive integer`);
        if (typeof item.weight !== 'number' || item.weight <= 0) err(`${item.id} weight must be > 0`);
        if (!has(ITEM_GLYPHS, item.glyph)) err(`${item.id} glyph "${item.glyph}" is not a collectible drawing`);
      }
    }
  }

  if (!Array.isArray(level.hazards) || level.hazards.length < 2) err('needs at least two hazards');
  else {
    const lanes = new Set();
    for (const hazard of level.hazards) {
      if (!hazard || !ID_RE.test(hazard.id || '')) err('each hazard needs an id');
      else {
        if (typeof hazard.name !== 'string') err(`${hazard.id} needs a name`);
        if (!has(LANES, hazard.lane)) err(`${hazard.id} lane must be low, mid, or high`);
        else lanes.add(hazard.lane);
        if (!has(HAZARD_GLYPHS, hazard.glyph)) err(`${hazard.id} glyph "${hazard.glyph}" is not a hazard drawing`);
      }
    }
    if (lanes.size < 2) err('use at least two hazard lanes so jumping and ducking both matter');
  }

  if (!Array.isArray(level.facts) || level.facts.length < 2) err('needs at least two facts');
  else {
    const seenAt = new Set();
    for (const fact of level.facts) {
      if (!fact || !ID_RE.test(fact.id || '')) err('each fact needs an id');
      else {
        if (typeof fact.title !== 'string' || fact.title.length < 2) err(`${fact.id} needs a title`);
        if (typeof fact.text !== 'string' || fact.text.length < 20) err(`${fact.id} text should be a full sentence`);
        if (typeof fact.at !== 'number' || fact.at <= 0 || fact.at >= 1) err(`${fact.id} at must be between 0 and 1`);
        const key = String(Math.round((fact.at || 0) * 100));
        if (seenAt.has(key)) err(`${fact.id} overlaps another fact`);
        seenAt.add(key);
      }
    }
  }
  return errors;
}

/**
 * Levels must form one chain: the first is open, and each later one requires the one just before it.
 * That is what makes "finish Thailand to unlock Vietnam" automatic for the next country too.
 */
export function validateLevelList(levels) {
  const errors = [];
  if (!Array.isArray(levels) || levels.length === 0) return ['No levels are registered.'];
  const sorted = [...levels].sort((a, b) => (a.order || 0) - (b.order || 0));
  const ids = new Set();
  sorted.forEach((level, index) => {
    for (const problem of validateLevel(level)) errors.push(problem);
    if (level && ids.has(level.id)) errors.push(`duplicate level id ${level.id}`);
    if (level) ids.add(level.id);
    const expectOrder = index + 1;
    if (!level || level.order !== expectOrder) errors.push(`${level?.id || '?'} should have order ${expectOrder}`);
    if (index === 0) {
      if (level?.requires) errors.push('the first level must set requires to null');
    } else if (level?.requires !== sorted[index - 1].id) {
      errors.push(`${level?.id} must set requires to "${sorted[index - 1].id}" so it unlocks next`);
    }
  });
  return errors;
}
