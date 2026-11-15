# Travel Quest

A small offline canvas game served at `/games/travel-quest/`. No login, no CDN, no build step: the browser loads these files as-is.

Thailand is open from the start. Vietnam unlocks after Thailand is finished (any star count). Scores, stars, and the mute setting live in `localStorage` under `seektrack.travelQuest.v1`.

## Play

- **Jump** — Space, W, Up, or the Jump button. Tap for a short hop (holes and puddles). Hold to clear scooters and buffalo.
- **Duck** — Down, S, or the Duck button. Shop signs and hanging lanterns sit at head height.
- **Pause** — P or Escape. **Mute** — M. **Restart** — R, or the Restart button.
- On the map, keys **1** and **2** start an unlocked country.

Hearts you still have at the passport gate add bonus points. Finishing is one star. About 45% of a perfect score (every souvenir plus every heart) is two stars. About 72% is three.

A run is 60–90 seconds. The world map, both countries, and the drawings are all original canvas art. The explorer (sun hat, lavender glasses, braids, pink sweatshirt, polka-dot skirt, backpack) is drawn the same way on the map and in the run, including jump and duck. Sound is generated in the browser.

`?level=thailand` starts that country. Add `&at=40` to preview 40 seconds in. Preview runs are not saved. `&debug=1` draws the hit boxes, for tuning a new country.

## Add a country

1. Copy `levels/template.js` to `levels/<id>.js`. Use a lowercase id (`laos`, `japan`, …).
2. Set `order` to the next number and `requires` to the previous country's id. The first country keeps `requires: null`. Each later country must require the one just before it, which is what unlocks it on the map.
3. Fill in `title`, `blurb`, `durationSec` (60–90), `accent`, biomes, collectibles, hazards, and facts. Biome `share` values must add up to 1.
4. Reuse drawings. Collectible `glyph` values: `mango`, `orchid`, `elephant`, `banhmi`, `lantern`, `hat`. Hazard `glyph` values: `pothole`, `scooter`, `sign`, `puddle`, `buffalo`, `hanglantern`. Background `far` / `mid` values: `temples`, `tuktuks`, `boats`, `awnings`, `palms`, `umbrellas`, `lanterns`, `shophouses`, `karsts`, `junks`, `terraces`. Lanes: `low` and `mid` are jumped, `high` is ducked. Item `weight` is how often that souvenir appears.
5. Register the file in `js/levels.js`:

   ```js
   import laos from '../levels/laos.js';

   export const LEVELS = [thailand, vietnam, laos].sort((a, b) => a.order - b.order);
   ```

   The map, the unlock rule, and the "next country" button all read this list. Do not import `levels/template.js`.

6. Optional new art: add a function in `js/draw.js`, put its id in the matching list in `js/catalog.js`, and name it from the level file. Keep colors flat and original — no downloaded images or fonts.

Open the page and check the new card. If something in the file is wrong, the game lists the problems instead of starting. `scripts/travel-quest.test.js` checks the same rules.

## Files

| Path | Role |
| --- | --- |
| `index.html`, `css/game.css` | Page, map, pause, stamp |
| `js/main.js` | Buttons, keyboard, saving |
| `js/engine.js` | Run loop, jump, collision |
| `js/draw.js` | The explorer, souvenirs, obstacles, and scenery |
| `js/run.js` | Turns a level into a fair 60–90s course |
| `js/levels.js` | The country list |
| `levels/*.js` | One country each |
| `js/progress.js` | Stars, unlocks, `localStorage` |
| `js/audio.js` | Tones and a quiet pentatonic loop |
