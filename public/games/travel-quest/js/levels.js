/**
 * Every playable country. To add one: create levels/<id>.js and import it here.
 * The world map, unlock order, and passport stamps all read this list.
 */
import thailand from '../levels/thailand.js';
import vietnam from '../levels/vietnam.js';

export const LEVELS = [thailand, vietnam].sort((a, b) => a.order - b.order);

export function levelById(id) {
  return LEVELS.find((level) => level.id === id) || null;
}

/** The country that comes after `id` in stamp order, if there is one. */
export function nextLevel(id) {
  const index = LEVELS.findIndex((level) => level.id === id);
  if (index < 0) return null;
  return LEVELS[index + 1] || null;
}
