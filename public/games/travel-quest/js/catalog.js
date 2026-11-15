/**
 * Art ids a level may name. Adding a country that reuses these needs no new drawing code.
 * A brand-new shape means one function in js/draw.js plus its id in the matching list here.
 */

/** Collectible drawings. */
export const ITEM_GLYPHS = ['mango', 'orchid', 'elephant', 'banhmi', 'lantern', 'hat'];

/** Obstacle drawings. */
export const HAZARD_GLYPHS = ['pothole', 'scooter', 'sign', 'puddle', 'buffalo', 'hanglantern'];

/** Scrolling background stamps. Levels pick one `far` and one `mid` per biome. */
export const MOTIFS = [
  'temples',
  'tuktuks',
  'boats',
  'awnings',
  'palms',
  'umbrellas',
  'lanterns',
  'shophouses',
  'karsts',
  'junks',
  'terraces',
];

/** Obstacle silhouette. `low` and `mid` are jumped; `high` is ducked. */
export const LANES = ['low', 'mid', 'high'];

/** Where a collectible sits. `ground` is a run-through; `air` needs a jump. */
export const ITEM_LANES = ['ground', 'air'];

export const GLYPHS = [...ITEM_GLYPHS, ...HAZARD_GLYPHS];
