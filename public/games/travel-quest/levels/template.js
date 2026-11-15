/**
 * Copy this file to levels/<country>.js, then add one import in js/levels.js.
 * Do not import this template itself — it is only an example.
 *
 * Reuse glyph and motif names from js/catalog.js. A new drawing is optional:
 * add a function in js/draw.js and its id in js/catalog.js.
 */
export default {
  id: 'example',
  title: 'Exampleland',
  blurb: 'Two short scenes to copy. Delete this sentence and write your own.',
  order: 1,
  requires: null,
  durationSec: 70,
  heartBonus: 50,
  accent: '#0c7c74',
  biomes: [
    {
      id: 'town',
      name: 'Town',
      share: 0.5,
      sky: ['#cfe8ff', '#7eb6e0'],
      ground: '#c9b48a',
      groundTop: '#efe3c4',
      hill: '#8aa4b8',
      far: 'temples',
      mid: 'awnings',
    },
    {
      id: 'hills',
      name: 'Hills',
      share: 0.5,
      sky: ['#d9f5c8', '#69b86a'],
      ground: '#6ea14a',
      groundTop: '#c6e39a',
      hill: '#3f7a32',
      far: 'terraces',
      mid: 'palms',
    },
  ],
  items: [
    { id: 'snack', name: 'Snack', points: 10, weight: 4, glyph: 'mango' },
    { id: 'flower', name: 'Flower', points: 25, weight: 2, glyph: 'orchid' },
  ],
  hazards: [
    { id: 'hole', name: 'Hole', lane: 'low', glyph: 'pothole' },
    { id: 'cart', name: 'Cart', lane: 'mid', glyph: 'scooter' },
  ],
  facts: [
    {
      id: 'hello',
      at: 0.3,
      title: 'A fact title',
      text: 'Write one or two short sentences a child can read while they keep running.',
    },
    {
      id: 'later',
      at: 0.7,
      title: 'Another fact',
      text: 'Put the second fact later in the level. `at` is a fraction from just after the start to just before the end.',
    },
  ],
};
