/**
 * Stars, unlocks, and local progress. Pure except loadSave/writeSave, which
 * touch localStorage (or a substitute passed in tests).
 */

import { isCharacter } from './cast.js';
import { LEGACY_CITIES } from './levels.js';

export const SAVE_KEY = 'seektrack.travelQuest.v1';

/** Share of a perfect score (souvenirs + full heart bonus) for 2 and 3 stars. Finishing is always 1. */
export const STAR_TWO = 0.45;
export const STAR_THREE = 0.72;

const ID_RE = /^[a-z0-9-]{1,40}$/;

export function emptySave() {
  return { v: 1, mute: false, helpSeen: false, character: '', levels: {} };
}

function readCheckpoint(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const time = Number(raw.time);
  const seed = Number(raw.seed);
  if (!Number.isFinite(time) || time < 1) return null;
  if (!Number.isFinite(seed) || seed < 1 || seed > 0x7fffffff) return null;
  return { time, score: clampScore(raw.score), seed: Math.floor(seed) };
}

function clampScore(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return 0;
  return Math.min(999999, Math.floor(x));
}

/** Drop anything that isn't a small plain record so a bad save can't break the game. */
export function normalizeSave(raw) {
  const save = emptySave();
  if (!raw || typeof raw !== 'object') return save;
  save.mute = Boolean(raw.mute);
  save.helpSeen = Boolean(raw.helpSeen);
  save.character = isCharacter(raw.character) ? raw.character : '';
  const levels = raw.levels && typeof raw.levels === 'object' ? raw.levels : {};
  for (const [id, row] of Object.entries(levels)) {
    if (!ID_RE.test(id) || !row || typeof row !== 'object') continue;
    const rowOut = {
      best: clampScore(row.best),
      stars: Math.max(0, Math.min(3, row.stars | 0)),
      cleared: Boolean(row.cleared),
    };
    const cp = readCheckpoint(row.checkpoint);
    if (cp) rowOut.checkpoint = cp;
    save.levels[id] = rowOut;
  }
  return save;
}

function memoryStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  };
}

let fallback = null;

function defaultStore() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch {
    /* private mode */
  }
  if (!fallback) fallback = memoryStore();
  return fallback;
}

export function loadSave(storage = defaultStore()) {
  try {
    const raw = storage.getItem(SAVE_KEY);
    return normalizeSave(raw ? JSON.parse(raw) : null);
  } catch {
    return emptySave();
  }
}

export function writeSave(save, storage = defaultStore()) {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    /* storage full or blocked: play continues, progress stays in memory */
  }
}

export function starsFor(score, ceiling) {
  if (!(ceiling > 0)) return 1;
  const ratio = score / ceiling;
  if (ratio >= STAR_THREE) return 3;
  if (ratio >= STAR_TWO) return 2;
  return 1;
}

/** Highest score this run could have posted: every souvenir plus every heart. */
export function scoreCeiling(events, heartBonus, hearts) {
  let total = hearts * heartBonus;
  for (const event of events) {
    if (event.type === 'item') total += event.spec.points;
  }
  return total;
}

export function starGlyphs(n) {
  const filled = Math.max(0, Math.min(3, n | 0));
  return `${'★'.repeat(filled)}${'☆'.repeat(3 - filled)}`;
}

export function isUnlocked(level, save) {
  if (!level.requires) return true;
  return Boolean(save.levels[level.requires]?.cleared);
}

function rowOf(save, levelId) {
  return save.levels[levelId] || { best: 0, stars: 0, cleared: false };
}

/** Remember a score even if the run ended early. Does not award a stamp. */
export function recordScore(save, levelId, score) {
  const prev = rowOf(save, levelId);
  const best = Math.max(prev.best, clampScore(score));
  if (best === prev.best && save.levels[levelId]) return save;
  return { ...save, levels: { ...save.levels, [levelId]: { ...prev, best } } };
}

/** A finished run stamps the passport, keeps the better star count, and unlocks whatever requires it. */
export function recordFinish(save, levelId, score, stars) {
  const prev = rowOf(save, levelId);
  return {
    ...save,
    levels: {
      ...save.levels,
      [levelId]: {
        best: Math.max(prev.best, clampScore(score)),
        stars: Math.max(prev.stars, Math.max(1, Math.min(3, stars | 0))),
        cleared: true,
      },
    },
  };
}

export function withMute(save, mute) {
  return { ...save, mute: Boolean(mute) };
}

export function withHelpSeen(save) {
  return { ...save, helpSeen: true };
}

export function withCharacter(save, id) {
  if (!isCharacter(id)) return save;
  return { ...save, character: id };
}

/**
 * Old saves stored a country id. If that country is stamped and none of its
 * cities are recorded yet, every city in it is stamped. A best score with no
 * stamp is copied onto the first city only. A country checkpoint is dropped:
 * that course no longer exists, so it must not resume a city.
 */
export function migrateLegacy(save, map = LEGACY_CITIES) {
  const levels = { ...save.levels };
  let changed = false;
  for (const [countryId, cityIds] of Object.entries(map || {})) {
    const row = levels[countryId];
    if (row && row.checkpoint) {
      levels[countryId] = { best: row.best, stars: row.stars, cleared: Boolean(row.cleared) };
      changed = true;
    }
    if (!Array.isArray(cityIds) || cityIds.some((id) => levels[id])) continue;
    if (!row) continue;
    if (row.cleared) {
      cityIds.forEach((id, index) => {
        levels[id] = {
          best: index === 0 ? row.best : 0,
          stars: row.stars || 1,
          cleared: true,
        };
      });
      changed = true;
    } else if (row.best > 0) {
      const first = cityIds[0];
      const prev = levels[first] || { best: 0, stars: 0, cleared: false };
      levels[first] = { ...prev, best: Math.max(prev.best, row.best) };
      changed = true;
    }
  }
  if (!changed) return save;
  return { ...save, levels };
}

export function checkpointOf(save, levelId) {
  const row = save.levels[levelId];
  return row && row.checkpoint ? row.checkpoint : null;
}

/** Remember the flag for this session and for the next visit. Pass null to forget it. */
export function withCheckpoint(save, levelId, checkpoint) {
  const prev = rowOf(save, levelId);
  const next = {
    best: prev.best,
    stars: prev.stars,
    cleared: prev.cleared,
  };
  const cp = readCheckpoint(checkpoint);
  if (cp) next.checkpoint = cp;
  return { ...save, levels: { ...save.levels, [levelId]: next } };
}
