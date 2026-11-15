/**
 * Playable travellers. Labels stay generic. Hit width matches the explorer;
 * adults are only a little taller in the hurt box so hurdles stay fair.
 */
export const CAST = [
  {
    id: 'explorer',
    label: 'Explorer',
    line: 'Sun hat, lavender glasses, and a backpack.',
    height: 1,
    hit: 1,
    anchorIdle: 0.54,
    anchorRun: 0.81,
    duckSplit: 0.42,
  },
  {
    id: 'dad',
    label: 'Dad',
    line: 'Straw hat, grey glasses, and a crossbody bag.',
    height: 112 / 96,
    hit: 1.15,
    anchorIdle: 0.58,
    anchorRun: 0.82,
    duckSplit: 0.38,
  },
  {
    id: 'mom',
    label: 'Mom',
    line: 'Wide straw hat, pearls, and a red floral dress.',
    height: 112 / 96,
    hit: 1.15,
    anchorIdle: 0.53,
    anchorRun: 0.86,
    duckSplit: 0.38,
  },
];

export function characterById(id) {
  return CAST.find((person) => person.id === id) || CAST[0];
}

export function isCharacter(id) {
  return CAST.some((person) => person.id === id);
}
