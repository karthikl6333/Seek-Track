/**
 * Thailand — first stamp. Register new countries the same way in js/levels.js.
 * See README.md.
 */
export default {
  id: 'thailand',
  title: 'Thailand',
  blurb: 'Tuk-tuk streets, a floating market, and a sunny beach.',
  order: 1,
  requires: null,
  durationSec: 75,
  heartBonus: 50,
  accent: '#ef5b3a',
  biomes: [
    {
      id: 'bangkok',
      name: 'Bangkok streets',
      share: 0.34,
      sky: ['#ffe1a8', '#ff8f6b'],
      ground: '#d8b56a',
      groundTop: '#f4e4b4',
      hill: '#e07a4c',
      far: 'temples',
      mid: 'tuktuks',
    },
    {
      id: 'market',
      name: 'Floating market',
      share: 0.33,
      sky: ['#c8f3ea', '#3d9d98'],
      ground: '#c4844a',
      groundTop: '#e7b27a',
      hill: '#2f7f86',
      far: 'boats',
      mid: 'awnings',
      water: true,
    },
    {
      id: 'beach',
      name: 'The beach',
      share: 0.33,
      sky: ['#b9e6ff', '#3ec6e0'],
      ground: '#f0d08a',
      groundTop: '#ffe7b0',
      hill: '#efb15a',
      far: 'palms',
      mid: 'umbrellas',
    },
  ],
  items: [
    { id: 'mango', name: 'Mango sticky rice', points: 10, weight: 5, glyph: 'mango' },
    { id: 'orchid', name: 'Orchid', points: 20, weight: 3, glyph: 'orchid' },
    { id: 'elephant', name: 'Elephant token', points: 40, weight: 1, glyph: 'elephant' },
  ],
  hazards: [
    { id: 'pothole', name: 'Pothole', lane: 'low', glyph: 'pothole' },
    { id: 'scooter', name: 'Scooter', lane: 'mid', glyph: 'scooter' },
    { id: 'sign', name: 'Shop sign', lane: 'high', glyph: 'sign' },
  ],
  facts: [
    {
      id: 'wat-arun',
      at: 0.16,
      title: 'Wat Arun',
      text: 'Wat Arun, the Temple of Dawn, stands by the Chao Phraya River. Its towers are covered in broken porcelain and seashells that catch the light.',
    },
    {
      id: 'grand-palace',
      at: 0.48,
      title: 'Grand Palace',
      text: 'Bangkok’s Grand Palace was begun in 1782, when the city became the capital. Gold leaf and tiny pieces of colored glass cover the buildings.',
    },
    {
      id: 'elephants',
      at: 0.78,
      title: 'Elephant sanctuaries',
      text: 'The Asian elephant is Thailand’s national symbol. Sanctuaries let elephants walk, bathe, and rest instead of performing tricks.',
    },
  ],
};
