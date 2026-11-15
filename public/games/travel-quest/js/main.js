/**
 * Wires the screens, keyboard, and touch controls to the runner.
 * The page is static: no network calls after it loads.
 */
import { createAudio } from './audio.js';
import { drawTraveller } from './draw.js';
import { createGame } from './engine.js';
import { LEVELS, levelById, nextLevel } from './levels.js';
import {
  checkpointOf,
  isUnlocked,
  loadSave,
  recordFinish,
  recordScore,
  starGlyphs,
  withCheckpoint,
  withHelpSeen,
  withMute,
  writeSave,
} from './progress.js';
import { validateLevelList } from './schema.js';

const $ = (id) => document.getElementById(id);

const ui = {
  map: $('screen-map'),
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
  stampCountry: $('stamp-country'),
  stampStars: $('stamp-stars'),
  stampDetail: $('stamp-detail'),
  stampBest: $('stamp-best'),
  stampNext: $('stamp-next'),
  live: $('live'),
  fatalText: $('fatal-text'),
  help: $('help'),
};

const problems = validateLevelList(LEVELS);
if (problems.length) {
  showFatal(problems.join('\n'));
} else {
  boot();
}

function showFatal(message) {
  ui.fatal.hidden = false;
  ui.fatalText.textContent = message;
  ui.map.hidden = true;
  ui.hud.hidden = true;
}

function boot() {
  let toastTimer = 0;
  const audio = createAudio();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let save = loadSave();
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
        ui.map.hidden = false;
        renderLevels();
      },
      showPause() {
        ui.pause.hidden = false;
        $('pause-resume').focus();
      },
      showStamp(result) {
        if (!result.practice) {
          save = recordFinish(save, result.level.id, result.total, result.stars);
          writeSave(save);
        }
        ui.stamp.hidden = false;
        ui.stampCountry.textContent = result.level.title;
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
        ui.stampNext.textContent = upcoming ? `Next: ${upcoming.title}` : 'Next country';
        announce(
          result.practice
            ? `Practice finished in ${result.level.title}.`
            : `${result.level.title} stamped. ${result.stars} ${result.stars === 1 ? 'star' : 'stars'}.`,
        );
        $('stamp-again').focus();
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
          heart.textContent = i < n ? '♥' : '♡';
          heart.className = i < n ? 'heart on' : 'heart';
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

  function renderLevels() {
    ui.list.replaceChildren();
    for (const level of LEVELS) {
      const unlocked = isUnlocked(level, save);
      const row = save.levels[level.id];
      const card = document.createElement('article');
      card.className = unlocked ? 'level-card' : 'level-card locked';

      const title = document.createElement('h2');
      title.textContent = `${level.order}. ${level.title}`;
      const blurb = document.createElement('p');
      blurb.textContent = level.blurb;
      const trail = document.createElement('p');
      trail.className = 'trail';
      trail.textContent = level.biomes.map((biome) => biome.name).join('  ·  ');
      const meta = document.createElement('p');
      meta.className = 'meta';
      if (!unlocked) {
        const prev = LEVELS.find((item) => item.id === level.requires);
        meta.textContent = `Locked until ${prev ? prev.title : 'the previous country'} is stamped.`;
      } else if (row?.cleared) {
        meta.textContent = `${starGlyphs(row.stars)}   Best ${row.best.toLocaleString()}`;
      } else if (row?.best) {
        meta.textContent = `Best ${row.best.toLocaleString()} · not stamped yet`;
      } else {
        meta.textContent = 'Not stamped yet';
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'play';
      button.textContent = unlocked ? 'Play' : 'Locked';
      button.disabled = !unlocked;
      button.addEventListener('click', () => {
        if (!unlocked) return;
        audio.unlock();
        audio.click();
        play(level);
      });
      card.append(title, blurb, trail, meta, button);
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

  $('map-mute').addEventListener('click', toggleMute);
  $('btn-mute').addEventListener('click', toggleMute);
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
    if (game.mode() === 'map' && /^[1-9]$/.test(event.key)) {
      const level = LEVELS[Number(event.key) - 1];
      if (level && isUnlocked(level, save)) play(level);
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

  const portrait = $('portrait');
  const portraitCtx = portrait.getContext('2d');
  const paintPortrait = (now) => {
    if (!ui.map.hidden && portraitCtx) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cssW = portrait.clientWidth || 132;
      const cssH = portrait.clientHeight || 168;
      const pw = Math.round(cssW * dpr);
      const ph = Math.round(cssH * dpr);
      if (portrait.width !== pw || portrait.height !== ph) {
        portrait.width = pw;
        portrait.height = ph;
      }
      portraitCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      portraitCtx.clearRect(0, 0, cssW, cssH);
      portraitCtx.fillStyle = '#ffe3b0';
      portraitCtx.beginPath();
      portraitCtx.ellipse(cssW * 0.5, cssH * 0.82, cssW * 0.34, cssH * 0.12, 0, 0, Math.PI * 2);
      portraitCtx.fill();
      const t = reducedMotion ? 0.6 : (now || 0) / 1000;
      drawTraveller(portraitCtx, cssW * 0.5, cssH * 0.92, cssH * 0.82, 'idle', t, 1);
    }
    requestAnimationFrame(paintPortrait);
  };
  requestAnimationFrame(paintPortrait);

  const params = new URLSearchParams(window.location.search);
  const requested = params.get('level');
  const at = Number(params.get('at'));
  if (requested) {
    const level = levelById(requested);
    if (level && isUnlocked(level, save)) {
      play(level, { at: Number.isFinite(at) ? at : 0 });
    } else {
      if (level) announce(`${level.title} is still locked.`);
      game.showMap();
    }
  } else {
    game.showMap();
  }
}
