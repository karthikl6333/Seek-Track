/**
 * Countries and the city chain. To add a country: create levels/<id>.js and import it here.
 * The world map, unlock order, and passport stamps all read this list.
 */
import dubai from '../levels/dubai.js';
import thailand from '../levels/thailand.js';
import vietnam from '../levels/vietnam.js';

export const COUNTRIES = [thailand, vietnam, dubai];

/** Old saves used these country ids. Migration copies a stamp onto every city. */
export const LEGACY_CITIES = {
  thailand: ['bangkok', 'chiang-mai', 'phi-phi'],
  vietnam: ['hanoi', 'hoi-an', 'halong'],
};

/** Pins sit in the top of the map so the city cards do not cover them. */
export const MAP_PINS = {
  bangkok: { x: 0.16, y: 0.16, label: 'Bangkok' },
  'chiang-mai': { x: 0.24, y: 0.1, label: 'Chiang Mai' },
  'phi-phi': { x: 0.13, y: 0.23, label: 'Phi Phi' },
  hanoi: { x: 0.4, y: 0.12, label: 'Hanoi' },
  'hoi-an': { x: 0.48, y: 0.2, label: 'Hoi An' },
  halong: { x: 0.4, y: 0.06, label: 'Ha Long' },
  downtown: { x: 0.64, y: 0.14, label: 'Downtown' },
  'old-dubai': { x: 0.74, y: 0.22, label: 'Creek' },
  desert: { x: 0.82, y: 0.1, label: 'Desert' },
};

function flatten(countries) {
  const levels = [];
  let order = 1;
  let previous = null;
  for (const country of countries) {
    country.cities.forEach((city, index) => {
      levels.push({
        ...city,
        order,
        requires: previous,
        countryId: country.id,
        countryTitle: country.title,
        countryBlurb: country.blurb,
        countryAccent: country.accent,
        countryRequires: country.requires ?? null,
        cityIndex: index,
        lastInCountry: index === country.cities.length - 1,
      });
      previous = city.id;
      order += 1;
    });
  }
  return levels;
}

export const LEVELS = flatten(COUNTRIES);

export function levelById(id) {
  return LEVELS.find((level) => level.id === id) || null;
}

export function countryById(id) {
  return COUNTRIES.find((country) => country.id === id) || null;
}

export function citiesOf(countryId) {
  return LEVELS.filter((level) => level.countryId === countryId);
}

/** The city that comes after `id` in the world route, if there is one. */
export function nextLevel(id) {
  const index = LEVELS.findIndex((level) => level.id === id);
  if (index < 0) return null;
  return LEVELS[index + 1] || null;
}
