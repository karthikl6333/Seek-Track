# Travel Quest

A small offline canvas game served at `/games/travel-quest/`. No login, no CDN, no build step: the browser loads these files as-is.

Bangkok is open from the start. Each country is three cities, unlocked one after another. Finishing the last city stamps that country’s passport and unlocks the next country: Thailand, then Vietnam, then Dubai. Scores, stars, the chosen traveller, and the mute setting live in `localStorage` under `seektrack.travelQuest.v1`.

An older save that stamped `thailand` or `vietnam` still counts. The next visit marks every city in that country cleared, keeps the best score on the first city, and does not copy the old checkpoints (the roads changed).

## Play

- **Choose a traveller** before the map: Explorer, Dad, or Mom. The choice is remembered. The Characters button on the map changes it. The same drawing appears on the map and in the corner of the score panel.
- **Jump** — Space, W, Up, or the Jump button. Tap for a short hop. Hold to clear taller hurdles.
- **Duck** — Down, S, or the Duck button. Signs, lanterns, lamps, and banners sit at head height.
- **Pause** — P or Escape. **Mute** — M. **Restart** — R, or the Restart button.
- On the map, keys **1**, **2**, and **3** start the next open city in that country.

Hearts you still have at the gate add bonus points. Finishing a city is one star. About 45% of a perfect score (every souvenir plus every heart) is two stars. About 72% is three. A combo meter is only for show; it does not change the score.

A city lasts 60–90 seconds and gets a little faster as the trip goes on. Jump tilts the run drawing. Duck keeps the head and shortens the legs. Adults are drawn a bit taller than the explorer. Their hurt box stays the same width and only about 15% taller, so the same jump still clears a hurdle.

Red flags at about one third, halfway, and two thirds are checkpoints. Running out of hearts and choosing “From checkpoint” puts you back on the last flag with full hearts and the score and souvenirs you had then. “From the start” forgets the flag.

Sound is made in the browser: a light tune on the map, and a different loop in each city, plus chimes for a jump, a souvenir, a bump, a checkpoint, and the stamp. M or the Sound button mutes it. Music starts on the first tap or key.

`?level=bangkok` starts that city. `?level=thailand` starts the first open city in Thailand. Add `&at=40` to preview 40 seconds in. Preview runs are not saved. `&debug=1` draws the hit boxes.

## Add a city

1. Open the country’s file in `levels/` (`thailand.js`, `vietnam.js`, or `dubai.js`).
2. Add an object to `cities`. Give it an `id`, `title`, `blurb`, `durationSec` (60–90), `accent`, `heat` from 0 to 1, `music` (a key in `js/audio.js`), two or more biomes, collectibles, hazards, and facts.
3. Biome `share` values must add up to 1. Set `far` and `mid` to motif ids, and `life` / `kind` so the crowd and the ground match the place (`street`, `sand`, `plank`, `paddy`).
4. Add the biome id to `LANDMARK_PLAN` in `js/scenery.js` so the skyline has a landmark.
5. Add a pin in `MAP_PINS` in `js/levels.js`, in the top band of the map.
6. The city list flattens into one chain. The new city unlocks after the one before it. The last city in the file stamps the passport.

## Add a country

1. Copy the shape of `levels/thailand.js` to `levels/<id>.js`. Use a lowercase id. Do not import `levels/template.js`; that file is only a single-level example.
2. Set `requires` to the previous country’s id. The first country keeps `requires: null`.
3. Give it at least two cities, each a valid level (see above).
4. Register the file in `js/levels.js`:

   ```js
   import laos from '../levels/laos.js';

   export const COUNTRIES = [thailand, vietnam, dubai, laos];
   ```

5. Add a tune in `js/audio.js` for each city’s `music` name.
6. Optional new art: add a function in `js/draw.js` or `js/glyphs.js`, put its id in `js/catalog.js`, and name it from the city. Outlines and soft shading are fine. Do not add photos.

Open the page and check the new card. If something in the file is wrong, the game lists the problems instead of starting. `scripts/travel-quest.test.js` checks the same rules, including a jump and a duck for Explorer, Dad, and Mom.

## Travellers

| Id | Label | Drawings |
| --- | --- | --- |
| `explorer` | Explorer | `assets/explorer-idle.png`, `assets/explorer-run.png` |
| `dad` | Dad | `assets/dad-idle.png`, `assets/dad-run.png` |
| `mom` | Mom | `assets/mom-idle.png`, `assets/mom-run.png` |

The explorer is the approved drawing: sun hat, lavender glasses, braids, pink sweatshirt, polka-dot skirt, backpack. Dad and Mom use the approved drawings too. The game never stores a photo.

Collectible drawings: `mango`, `orchid`, `elephant`, `banhmi`, `lantern`, `hat`, `shell`, `pho`, `pearl`, `gold`, `dates`.

Hazard drawings: `pothole`, `scooter`, `sign`, `puddle`, `buffalo`, `hanglantern`, `elewalk`, `crate`, `stall`, `buggy`, `barrier`, `taxi`, `lamp`, `dune`, `banner`. Lanes: `low` and `mid` are jumped, `high` is ducked.

Background motifs: `temples`, `tuktuks`, `boats`, `awnings`, `palms`, `umbrellas`, `lanterns`, `shophouses`, `karsts`, `junks`, `terraces`, `cliffs`, `longtails`, `stalls`, `ruins`, `redbridge`, `jpbridge`, `metro`, `towers`, `fountain`, `windtowers`, `souks`, `abras`, `dunes`, `sail`, `camels`, `palmisle`.

## Files

| Path | Role |
| --- | --- |
| `index.html`, `css/game.css` | Page, character select, map, pause, stamp |
| `js/main.js` | Buttons, keyboard, saving |
| `js/engine.js` | Run loop, jump, collision, parallax |
| `js/draw.js` | Travellers, souvenirs, obstacles |
| `js/scenery.js` | Skies, landmarks, crowds |
| `js/glyphs.js` | Extra souvenirs and hurdles |
| `js/cast.js` | Explorer, Dad, and Mom |
| `js/feel.js` | Squash, combo, magnet |
| `js/run.js` | Turns a city into a fair course |
| `js/levels.js` | Countries, the city chain, map pins |
| `levels/*.js` | One country each |
| `js/progress.js` | Stars, unlocks, `localStorage` |
| `js/audio.js` | Tones and a quiet loop per city |
