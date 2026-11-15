/**
 * Wires the screens, keyboard, and touch controls to the runner.
 * The page is static: no network calls after it loads.
 */
import { createAudio } from './audio.js';
import { CAST, characterById } from './cast.js';
import { drawTraveller } from './draw.js';
import { createGame } from './engine.js';
import { COUNTRIES, LEVELS, MAP_PINS, countryById, levelById, nextLevel } from './levels.js';
import {
  checkpointOf,
  isUnlocked,
  loadSave,
  migrateLegacy,
  recordFinish,
  recordScore,
  starGlyphs,
  withCharacter,
  withCheckpoint,
  withHelpSeen,
  withMute,
  writeSave,
} from './progress.js';
import { validateCountryList, validateLevelList } from './schema.js';

const $ = (id) => document.getElementById(id);

const ui = {
  map: $('screen-map'),
  cast: $('screen-cast'),
  hud: $('hud'),
  pause: $('screen-pause'),
  over: $('screen-over'),
  stamp: $('screen-stamp'),
  fatal: $('fatal'),
  list: $('level-list'),
  score: $('score'),
  hearts: $('hearts'),
  biome: $('biome'),
  practice: $('practice'),
  track: $('track'),
  progress: $('progress'),
  marks: $('marks'),
  toast: $('toast'),
  hint: $('hint'),
  fact: $('fact'),
  factTitle: $('fact-title'),
  factText: $('fact-text'),
  overText: $('over-text'),
  overScore: $('over-score'),
  stampHeading: $('stamp-heading'),
  stampCountry: $('stamp-country'),
  stampStars: $('stamp-stars'),
  stampDetail: $('stamp-detail'),
  stampBest: $('stamp-best'),
  stampNext: $('stamp-next'),
  combo: $('combo'),
  intro: $('intro'),
  introKicker: $('intro-kicker'),
  introTitle: $('intro-title'),
  confetti: $('confetti'),
  live: $('live'),
  fatalText: $('fatal-text'),
  help: $('help'),
  portrait: $('portrait'),
};

const problems = [...validateCountryList(COUNTRIES), ...validateLevelList(LEVELS)];
if (problems.length) {
  showFatal(problems.join('\n'));
} else {
  boot();
}

function showFatal(message) {
  ui.fatal.hidden = false;
  ui.fatalText.textContent = message;
  ui.map.hidden = true;
  ui.cast.hidden = true;
  ui.hud.hidden = true;
}

function boot() {
  let toastTimer = 0;
  let introTimer = 0;
  let pending = null;
  const audio = createAudio();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let save = migrateLegacy(loadSave());
  writeSave(save);
  let current = null;

  audio.setMuted(save.mute);
  paintMute();
  ui.help.open = !save.helpSeen;

  const game = createGame({
    canvas: $('view'),
    audio,
    reducedMotion,
    ui: {
      prepareRun({ accent, practice }) {
        ui.map.hidden = true;
        ui.cast.hidden = true;
        ui.pause.hidden = true;
        ui.over.hidden = true;
        ui.stamp.hidden = true;
        ui.hud.hidden = false;
        ui.progress.style.background = accent;
        ui.practice.hidden = !practice;
      },
      resumeRun() {
        ui.pause.hidden = true;
      },
      showMap() {
        ui.hud.hidden = true;
        ui.pause.hidden = true;
        ui.over.hidden = true;
        ui.stamp.hidden = true;
        ui.cast.hidden = true;
        ui.map.hidden = false;
        renderLevels();
        syncWorld();
      },
      showPause() {
        ui.pause.hidden = false;
        $('pause-resume').focus();
      },
      showStamp(result) {
        const passport = Boolean(result.level.lastInCountry);
        if (!result.practice) {
          save = recordFinish(save, result.level.id, result.total, result.stars);
          if (passport) save = recordFinish(save, result.level.countryId, result.total, result.stars);
          writeSave(save);
        }
        ui.stamp.hidden = false;
        ui.stampHeading.textContent = passport ? 'Passport stamped' : 'City cleared';
        ui.stampCountry.textContent = passport ? result.level.countryTitle : result.level.title;
        ui.stampStars.textContent = starGlyphs(result.stars);
        const souvenir = `${result.score.toLocaleString()} from souvenirs`;
        const hearts = `${result.bonus.toLocaleString()} heart bonus`;
        ui.stampDetail.textContent = result.practice
          ? `Practice run. ${souvenir} + ${hearts}. Not saved.`
          : `${souvenir} + ${hearts} = ${result.total.toLocaleString()}.`;
        const best = save.levels[result.level.id];
        ui.stampBest.textContent = best
          ? `Best score ${best.best.toLocaleString()} · ${starGlyphs(best.stars)}`
          : '';
        const upcoming = nextLevel(result.level.id);
        const open = Boolean(upcoming && isUnlocked(upcoming, save));
        ui.stampNext.hidden = !open;
        ui.stampNext.textContent = upcoming
          ? `Next: ${upcoming.title}`
          : 'Next city';
        if (!reducedMotion) throwConfetti();
        announce(
          result.practice
            ? `Practice finished in ${result.level.title}.`
            : passport
              ? `${result.level.countryTitle} stamped. ${result.stars} ${result.stars === 1 ? 'star' : 'stars'}.`
              : `${result.level.title} cleared. ${result.stars} ${result.stars === 1 ? 'star' : 'stars'}.`,
        );
        $('stamp-again').focus();
        syncWorld();
      },
      showOver(result) {
        if (!result.practice) {
          save = recordScore(save, result.level.id, result.score);
          writeSave(save);
        }
        const cp = !result.practice && current ? checkpointOf(save, current.id) : null;
        ui.over.hidden = false;
        ui.overText.textContent = cp
          ? `The ${result.hazardName.toLowerCase()} got in the way. The last flag still has your score and souvenirs.`
          : `The ${result.hazardName.toLowerCase()} got in the way. Dust off and try the road again.`;
        ui.overScore.textContent = result.practice
          ? 'Practice run — score not saved.'
          : `Score ${result.score.toLocaleString()}.`;
        $('over-retry').textContent = cp ? 'From checkpoint' : 'Try again';
        $('over-begin').hidden = !cp;
        announce(`Trip interrupted by a ${result.hazardName}.`);
        $('over-retry').focus();
      },
      toast(text) {
        ui.toast.hidden = false;
        ui.toast.textContent = text;
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => {
          ui.toast.hidden = true;
        }, 1600);
      },
      saveCheckpoint(cp) {
        if (!current) return;
        save = withCheckpoint(save, current.id, cp);
        writeSave(save);
      },
      setMarks(fractions) {
        ui.marks.replaceChildren();
        for (const frac of fractions) {
          const mark = document.createElement('i');
          mark.className = 'cp-mark';
          mark.style.left = `${frac * 100}%`;
          mark.dataset.at = String(frac);
          ui.marks.append(mark);
        }
      },
      setScore(n) {
        ui.score.textContent = n.toLocaleString();
      },
      setHearts(n) {
        ui.hearts.replaceChildren();
        for (let i = 0; i < 3; i += 1) {
          const heart = document.createElement('span');
          heart.className = i < n ? 'heart-ico on' : 'heart-ico';
          ui.hearts.append(heart);
        }
        ui.hearts.setAttribute('aria-label', `${n} of 3 hearts`);
      },
      setBiome(name) {
        ui.biome.textContent = name;
      },
      setProgress(fraction) {
        const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
        ui.progress.style.width = `${pct}%`;
        ui.track.setAttribute('aria-valuenow', String(pct));
        for (const mark of ui.marks.children) {
          mark.classList.toggle('reached', fraction + 0.004 >= Number(mark.dataset.at));
        }
      },
      setHint(show) {
        ui.hint.hidden = !show;
      },
      setCombo(n) {
        if (!n || n < 2) {
          ui.combo.hidden = true;
          return;
        }
        ui.combo.hidden = false;
        ui.combo.textContent = `Combo ×${n}`;
      },
      showIntro(card) {
        ui.intro.hidden = false;
        ui.introKicker.textContent = card.kicker || '';
        ui.introTitle.textContent = card.title || '';
        window.clearTimeout(introTimer);
        introTimer = window.setTimeout(() => {
          ui.intro.hidden = true;
        }, 1800);
      },
      setFact(fact) {
        if (!fact) {
          ui.fact.hidden = true;
          return;
        }
        ui.fact.hidden = false;
        ui.factTitle.textContent = fact.title;
        ui.factText.textContent = fact.text;
        announce(`${fact.title}. ${fact.text}`);
      },
      announce,
      fatal: showFatal,
    },
  });

  function announce(text) {
    ui.live.textContent = '';
    window.setTimeout(() => {
      ui.live.textContent = text;
    }, 30);
  }

  function throwConfetti() {
    ui.confetti.hidden = false;
    ui.confetti.replaceChildren();
    const colors = ['#ef5b3a', '#e3a008', '#0c7c74', '#3aa6a0', '#f2c14e'];
    for (let i = 0; i < 22; i += 1) {
      const bit = document.createElement('i');
      bit.style.left = `${(i * 17) % 100}%`;
      bit.style.background = colors[i % colors.length];
      bit.style.animationDelay = `${(i % 6) * 0.05}s`;
      ui.confetti.append(bit);
    }
  }

  function paintMute() {
    const label = save.mute ? 'Muted' : 'Sound';
    for (const id of ['map-mute', 'btn-mute']) {
      const button = $(id);
      button.textContent = label;
      button.setAttribute('aria-pressed', String(save.mute));
    }
  }

  function toggleMute() {
    audio.unlock();
    save = withMute(save, !save.mute);
    writeSave(save);
    audio.setMuted(save.mute);
    paintMute();
  }

  function syncWorld() {
    const person = characterById(save.character);
    game.setCharacter(person.id);
    ui.portrait.setAttribute('aria-label', `${person.label}. ${person.line}`);
    for (const card of document.querySelectorAll('.cast-card')) {
      card.classList.toggle('picked', card.dataset.cast === person.id && Boolean(save.character));
    }
    game.setMapPins(
      LEVELS.map((level, index) => {
        const pin = MAP_PINS[level.id] || { x: 0.2, y: 0.16, label: level.title };
        const unlocked = isUnlocked(level, save);
        const cleared = Boolean(save.levels[level.id]?.cleared);
        return {
          x: pin.x,
          y: pin.y,
          label: pin.label || level.title,
          state: cleared ? 'done' : unlocked ? 'open' : 'locked',
          phase: index * 0.35,
        };
      }),
    );
  }

  function renderLevels() {
    ui.list.replaceChildren();
    for (const country of COUNTRIES) {
      const cities = LEVELS.filter((level) => level.countryId === country.id);
      const stamped = cities.every((city) => save.levels[city.id]?.cleared) || Boolean(save.levels[country.id]?.cleared);
      const card = document.createElement('article');
      card.className = 'country-card level-card';
      const title = document.createElement('h2');
      title.textContent = country.title;
      const blurb = document.createElement('p');
      blurb.textContent = country.blurb;
      const meta = document.createElement('p');
      meta.className = 'meta';
      meta.textContent = stamped ? 'Passport stamped' : 'Cities unlock in order';
      const row = document.createElement('div');
      row.className = 'city-row';
      for (const city of cities) {
        const unlocked = isUnlocked(city, save);
        const record = save.levels[city.id];
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'play';
        const stars = record?.cleared ? ` ${starGlyphs(record.stars)}` : '';
        button.textContent = unlocked ? `${city.title}${stars}` : `${city.title} · locked`;
        button.disabled = !unlocked;
        button.addEventListener('click', () => {
          if (!unlocked) return;
          audio.unlock();
          audio.click();
          play(city);
        });
        row.append(button);
      }
      card.append(title, blurb, meta, row);
      ui.list.append(card);
    }
  }

  function play(level, opts) {
    current = level;
    audio.unlock();
    game.start(level, opts);
  }

  function restart() {
    if (!current) return;
    audio.click();
    const cp = checkpointOf(save, current.id);
    if (cp) play(current, { seed: cp.seed, checkpoint: cp });
    else play(current);
  }

  function restartFresh() {
    if (!current) return;
    audio.click();
    save = withCheckpoint(save, current.id, null);
    writeSave(save);
    play(current);
  }

  function showCast() {
    ui.map.hidden = true;
    ui.hud.hidden = true;
    ui.pause.hidden = true;
    ui.over.hidden = true;
    ui.stamp.hidden = true;
    ui.cast.hidden = false;
    $('cast-back').hidden = !save.character;
    game.holdMap();
    syncWorld();
  }

  function chooseCharacter(id) {
    save = withCharacter(save, id);
    writeSave(save);
    syncWorld();
    audio.unlock();
    audio.click();
    ui.cast.hidden = true;
    const next = pending;
    pending = null;
    if (next && isUnlocked(next.level, save)) play(next.level, { at: next.at });
    else game.showMap();
  }

  function resolveRequest(id) {
    const city = levelById(id);
    if (city) return city;
    const country = countryById(id);
    if (!country) return null;
    const cities = LEVELS.filter((level) => level.countryId === country.id);
    return (
      cities.find((level) => isUnlocked(level, save) && !save.levels[level.id]?.cleared) ||
      cities.find((level) => isUnlocked(level, save)) ||
      null
    );
  }

  function paintFigure(canvas, pose, now) {
    const context = canvas.getContext('2d');
    if (!context) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = canvas.clientWidth || canvas.width;
    const cssH = canvas.clientHeight || canvas.height;
    const pw = Math.round(cssW * dpr);
    const ph = Math.round(cssH * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, cssW, cssH);
    const t = reducedMotion ? 0.6 : (now || 0) / 1000;
    const who = canvas.dataset.who || characterById(save.character).id;
    drawTraveller(context, cssW * 0.5, cssH * 0.92, cssH * 0.78, pose, t, 1, null, who);
  }

  $('map-mute').addEventListener('click', toggleMute);
  $('btn-mute').addEventListener('click', toggleMute);
  $('map-cast').addEventListener('click', () => {
    audio.unlock();
    showCast();
  });
  $('cast-back').addEventListener('click', () => game.showMap());
  for (const card of document.querySelectorAll('.cast-card')) {
    card.addEventListener('click', () => chooseCharacter(card.dataset.cast));
  }
  $('btn-pause').addEventListener('click', () => {
    audio.unlock();
    if (game.mode() === 'play') game.pause();
  });
  $('btn-restart').addEventListener('click', restartFresh);
  $('pause-resume').addEventListener('click', () => game.resume());
  $('pause-restart').addEventListener('click', restartFresh);
  $('pause-map').addEventListener('click', () => game.showMap());
  $('over-retry').addEventListener('click', restart);
  $('over-begin').addEventListener('click', restartFresh);
  $('over-map').addEventListener('click', () => game.showMap());
  $('stamp-again').addEventListener('click', restart);
  $('stamp-map').addEventListener('click', () => game.showMap());
  $('stamp-next').addEventListener('click', () => {
    if (!current) return;
    const upcoming = nextLevel(current.id);
    if (upcoming && isUnlocked(upcoming, save)) play(upcoming);
  });

  ui.help.addEventListener('toggle', () => {
    if (!ui.help.open && !save.helpSeen) {
      save = withHelpSeen(save);
      writeSave(save);
    }
  });

  const jump = $('btn-jump');
  const duck = $('btn-duck');
  let jumpLock = 0;
  function queueJump(fromClick) {
    const now = performance.now();
    if (now - jumpLock < 40) return;
    jumpLock = now;
    game.input.jumpQueued = true;
    if (!fromClick) game.input.jumpHeld = true;
    audio.unlock();
  }
  jump.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    queueJump(false);
  });
  jump.addEventListener('click', (event) => {
    event.preventDefault();
    queueJump(true);
  });
  jump.addEventListener('pointerup', () => {
    game.input.jumpHeld = false;
  });
  window.addEventListener('pointerup', () => {
    game.input.jumpHeld = false;
  });
  window.addEventListener('pointercancel', () => {
    game.input.jumpHeld = false;
  });
  jump.addEventListener('pointercancel', () => {
    game.input.jumpHeld = false;
  });
  duck.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    game.input.duckHeld = true;
    audio.unlock();
  });
  const releaseDuck = () => {
    game.input.duckHeld = false;
  };
  duck.addEventListener('pointerup', releaseDuck);
  duck.addEventListener('pointercancel', releaseDuck);
  duck.addEventListener('pointerleave', releaseDuck);

  window.addEventListener('pointerdown', () => audio.unlock(), { passive: true });

  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    audio.unlock();
    const tag = event.target && event.target.tagName;
    const onControl = tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY';
    if (!onControl && (event.key === ' ' || event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
    }
    if (onControl && (event.key === ' ' || event.key === 'Enter')) return;

    if (!ui.cast.hidden && /^[1-3]$/.test(event.key)) {
      chooseCharacter(CAST[Number(event.key) - 1].id);
      return;
    }

    const playing = game.mode() === 'play' || game.mode() === 'paused';
    if (event.key === 'p' || event.key === 'P' || event.key === 'Escape') {
      if (game.mode() === 'play') game.pause();
      else if (game.mode() === 'paused') game.resume();
      return;
    }
    if ((event.key === 'm' || event.key === 'M') && playing) {
      toggleMute();
      return;
    }
    if ((event.key === 'r' || event.key === 'R') && playing) {
      restart();
      return;
    }
    if (game.mode() === 'map' && ui.cast.hidden && /^[1-9]$/.test(event.key)) {
      const country = COUNTRIES[Number(event.key) - 1];
      if (!country) return;
      const cities = LEVELS.filter((level) => level.countryId === country.id);
      const level =
        cities.find((item) => isUnlocked(item, save) && !save.levels[item.id]?.cleared) ||
        cities.find((item) => isUnlocked(item, save));
      if (level) play(level);
      return;
    }
    if (game.mode() !== 'play') return;
    if (event.key === ' ' || event.key === 'ArrowUp' || event.key === 'w' || event.key === 'W') queueJump();
    if (event.key === 'ArrowDown' || event.key === 's' || event.key === 'S') game.input.duckKey = true;
  });

  window.addEventListener('keyup', (event) => {
    if (event.key === ' ' || event.key === 'ArrowUp' || event.key === 'w' || event.key === 'W') {
      game.input.jumpHeld = false;
    }
    if (event.key === 'ArrowDown' || event.key === 's' || event.key === 'S') game.input.duckKey = false;
  });

  window.addEventListener('blur', () => {
    game.input.jumpHeld = false;
    game.input.duckKey = false;
    game.input.duckHeld = false;
  });

  for (const card of document.querySelectorAll('.cast-card')) {
    const canvas = card.querySelector('canvas');
    if (canvas) canvas.dataset.who = card.dataset.cast;
  }

  const face = $('hud-face');
  const paintPortrait = (now) => {
    if (!ui.map.hidden) paintFigure(ui.portrait, 'idle', now);
    if (!ui.cast.hidden) {
      for (const card of document.querySelectorAll('.cast-card canvas')) paintFigure(card, 'idle', now);
    }
    if (!ui.hud.hidden) paintFigure(face, game.mode() === 'play' ? 'run' : 'idle', now);
    requestAnimationFrame(paintPortrait);
  };
  requestAnimationFrame(paintPortrait);

  const params = new URLSearchParams(window.location.search);
  const requested = params.get('level');
  const at = Number(params.get('at'));
  if (requested) {
    const level = resolveRequest(requested);
    if (level && isUnlocked(level, save)) pending = { level, at: Number.isFinite(at) ? at : 0 };
    else if (level) announce(`${level.title} is still locked.`);
  }
  syncWorld();
  if (!save.character) showCast();
  else if (pending) {
    const next = pending;
    pending = null;
    play(next.level, { at: next.at });
  } else game.showMap();
}
