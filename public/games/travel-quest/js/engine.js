/**
 * Side-scrolling run. The traveller stays put; the country scrolls to them.
 * A level file describes the trip. This file only moves, collides, and paints.
 */
import { characterById } from './cast.js';
import { bumpCombo, magnetPull, squashStretch } from './feel.js';
import { pixelRatio } from './layers.js';
import { scoreCeiling, starsFor } from './progress.js';
import {
  COYOTE,
  IFRAME,
  JUMP_BUFFER,
  gravityOf,
  hazardArtBox,
  hazardHitBox,
  playerHitBox,
  shortHopSpeed,
  takeoffSpeed,
} from './physics.js';
import { applyCheckpoint, biomeAt, boxesOverlap, buildRun, mulberry32, resumePoint } from './run.js';
import * as draw from './draw.js';

const HEARTS = 3;

function inflate(box, margin) {
  const dx = box.w * margin;
  const dy = box.h * margin;
  return { x: box.x - dx, y: box.y - dy, w: box.w + dx * 2, h: box.h + dy * 2 };
}

function biomeWindow(level, biomeId) {
  let cursor = 0;
  for (const biome of level.biomes) {
    const end = cursor + biome.share * level.durationSec;
    if (biome.id === biomeId) return { start: cursor, end };
    cursor = end;
  }
  return { start: 0, end: level.durationSec };
}

export function createGame({ canvas, audio, ui, reducedMotion }) {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas is not available in this browser.');

  const input = {
    jumpQueued: false,
    jumpHeld: false,
    duckHeld: false,
    duckKey: false,
  };

  let raf = 0;
  let mode = 'map';
  let level = null;
  let run = null;
  let ceiling = 1;
  let time = 0;
  let anim = 0;
  let score = 0;
  let hearts = HEARTS;
  let foot = 0;
  let vy = 0;
  let coyote = 0;
  let jumpBuf = 0;
  let jumpCut = false;
  let iframe = 0;
  let shake = 0;
  let last = 0;
  let resetClock = false;
  let practice = false;
  let runSeed = 1;
  let doomed = false;
  let doomTimer = 0;
  let lastHazardName = '';
  let bannerUntil = 0;
  let hintOn = false;
  let dpr = 1;
  let castId = 'explorer';
  let pins = [];
  let combo = 0;
  let lastCollect = -99;
  let landPulse = 0;
  let dustClock = 0;
  let rush = 0;
  let introBiome = '';
  let wasAir = false;
  const particles = [];
  const debug = new URLSearchParams(window.location.search).get('debug') === '1';
  let noted = '';

  function recoverable(err) {
    const name = err && err.name ? err.name : '';
    const message = err && err.message ? String(err.message) : '';
    if (/expected pattern|not a valid selector|Invalid URL|not in the allowed range/i.test(message)) return true;
    return (
      name === 'SyntaxError' ||
      name === 'InvalidStateError' ||
      name === 'IndexSizeError' ||
      name === 'NotSupportedError' ||
      name === 'DataError' ||
      name === 'EncodingError'
    );
  }

  function remember(err) {
    const message = err && err.message ? String(err.message) : 'Something went wrong.';
    if (message === noted || !ui.note) return;
    noted = message;
    ui.note(message);
  }

  function guard(fn) {
    try {
      fn();
    } catch (err) {
      if (!recoverable(err)) throw err;
      remember(err);
    }
  }

  function layout() {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    const ph = Math.max(58, Math.min(108, h * 0.155));
    const groundY = Math.min(h * 0.72, h - 108);
    const playerX = Math.max(84, Math.min(w * 0.24, w * 0.4));
    const heat = level ? Math.max(0, Math.min(1, Number(level.heat) || 0)) : 0;
    const speed = Math.max(160, w * 0.34) * (1 + heat * 0.12);
    return { w, h, ph, groundY, playerX, speed };
  }

  function resize() {
    const next = pixelRatio();
    if (next !== dpr) {
      dpr = next;
      draw.clearArtCache();
    }
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
  }

  function duckingNow() {
    return (input.duckHeld || input.duckKey) && foot < 4 && vy <= 0;
  }

  function hitScale() {
    return characterById(castId).hit;
  }

  function playerBox(L) {
    return playerHitBox(L, foot, duckingNow(), hitScale());
  }

  function itemCenterY(L, lane) {
    const lift = lane === 'air' ? L.ph * 1.05 : L.ph * 0.42;
    return L.groundY - lift;
  }

  function itemPoint(L, lane, x) {
    const rawY = itemCenterY(L, lane);
    const chestY = L.groundY - foot - L.ph * 0.4;
    const pull = magnetPull(L.playerX - x, chestY - rawY, L.ph * 1.2);
    return { x: x + pull.x, y: rawY + pull.y, pop: pull.pop };
  }

  function itemBox(L, lane, centerX, centerY) {
    const s = L.ph * 0.32;
    return inflate({ x: centerX - s / 2, y: centerY - s / 2, w: s, h: s }, 0.22);
  }

  function burst(x, y, color, text, kind) {
    if (text) {
      particles.push({ x, y, vx: 18, vy: -42, life: 0.7, max: 0.7, color, text, grav: 0, kind: 'text' });
    }
    if (reducedMotion) return;
    const count = kind === 'hit' ? 10 : 6;
    for (let i = 0; i < count; i += 1) {
      particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 180,
        vy: -40 - Math.random() * 120,
        life: 0.45,
        max: 0.45,
        color,
        text: '',
        grav: 280,
        kind: kind === 'dust' ? 'dust' : 'spark',
        rot: Math.random() * 6,
        r: 3 + Math.random() * 4,
      });
    }
    if (particles.length > 64) particles.splice(0, particles.length - 64);
  }

  function showFact(fact) {
    bannerUntil = time + 4.4;
    ui.setFact(fact);
    audio.fact();
  }

  function syncHud(L) {
    ui.setProgress(level ? Math.min(1, time / level.durationSec) : 0);
    const showHint = hintOn && time < 4.2;
    ui.setHint(showHint);
    if (bannerUntil && time > bannerUntil) {
      bannerUntil = 0;
      ui.setFact(null);
    }
    if (level) {
      const span = biomeAt(level, Math.min(time, level.durationSec));
      ui.setBiome(span.showing.name);
      if (span.showing.name !== introBiome) {
        const first = introBiome === '';
        introBiome = span.showing.name;
        if (ui.showIntro && first && time < 0.5) {
          ui.showIntro({ kicker: level.countryTitle || '', title: level.title });
        } else if (ui.showIntro && !first) {
          ui.showIntro({ kicker: 'Now entering', title: span.showing.name });
        }
      }
    }
    return L;
  }

  function finish() {
    if (mode !== 'play' || !level) return;
    const bonus = hearts * level.heartBonus;
    const total = score + bonus;
    const stars = starsFor(total, ceiling);
    mode = 'stamp';
    audio.stamp();
    ui.showStamp({
      level,
      score,
      bonus,
      total,
      stars,
      practice,
    });
  }

  function gameOver() {
    if (mode !== 'play') return;
    mode = 'over';
    ui.showOver({
      level,
      score,
      hazardName: lastHazardName || 'obstacle',
      practice,
    });
  }

  function step(dt) {
    const L = layout();
    if (L.w < 2 || L.h < 2) return;
    const gravity = gravityOf(L.h);
    const jumpV = takeoffSpeed(L.h, L.ph);
    const shortV = shortHopSpeed(L.h, L.ph);

    const onGround = foot <= 0.5 && vy <= 0;
    if (onGround) {
      foot = 0;
      vy = 0;
      coyote = COYOTE;
      jumpCut = false;
    } else {
      coyote -= dt;
    }

    if (input.jumpQueued) {
      jumpBuf = JUMP_BUFFER;
      input.jumpQueued = false;
    } else {
      jumpBuf -= dt;
    }

    const holdingDuck = input.duckHeld || input.duckKey;
    if (jumpBuf > 0 && coyote > 0 && !(holdingDuck && onGround) && !doomed) {
      vy = jumpV;
      foot = Math.max(foot, 1);
      coyote = 0;
      jumpBuf = 0;
      jumpCut = false;
      audio.jump();
    }
    if (!input.jumpHeld && vy > shortV && !jumpCut) {
      vy = shortV;
      jumpCut = true;
    }

    if (foot > 0 || vy > 0) {
      let g = gravity;
      if (holdingDuck && foot > 6) g *= 1.75;
      vy -= g * dt;
      foot += vy * dt;
      if (foot <= 0) {
        foot = 0;
        vy = 0;
      }
    }

    if (wasAir && foot === 0) {
      landPulse = 0.16;
      burst(L.playerX, L.groundY, '#c4a574', '', 'dust');
    }
    wasAir = foot > 2;
    if (landPulse > 0) landPulse -= dt;

    if (iframe > 0) iframe -= dt;
    if (shake > 0) shake -= dt;
    rush = Math.min(1, rush + dt * 0.12);

    const running = foot < 2 && !duckingNow();
    if (running && !reducedMotion) {
      dustClock += dt;
      if (dustClock > 0.13) {
        dustClock = 0;
        particles.push({
          x: L.playerX - 10,
          y: L.groundY,
          vx: -40,
          vy: -12,
          life: 0.35,
          max: 0.35,
          color: 'rgba(120, 92, 58, 0.45)',
          text: '',
          grav: 40,
          kind: 'dust',
          r: 4,
        });
      }
    }

    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.grav * dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
    if (particles.length > 64) particles.splice(0, particles.length - 64);

    const body = playerBox(L);
    for (const event of run.events) {
      const x = L.playerX + (event.t - time) * L.speed;
      if (event.fade > 0) event.fade -= dt;
      if (event.type === 'finish') {
        if (!doomed && !event.fired && time >= event.t) {
          event.fired = true;
          finish();
        }
        continue;
      }
      if (event.type === 'fact') {
        if (!event.fired && time >= event.t) {
          event.fired = true;
          showFact(event.fact);
        }
        continue;
      }
      if (event.type === 'checkpoint') {
        if (!event.fired && time >= event.t) {
          event.fired = true;
          if (!practice) guard(() => ui.saveCheckpoint({ time: event.t, score, seed: runSeed }));
          guard(() => ui.toast('Checkpoint!'));
          guard(() => audio.checkpoint());
        }
        continue;
      }
      if (event.dead) continue;
      if (x < -L.ph * 2 || x > L.w + L.ph * 2) continue;
      if (event.type === 'item') {
        const point = itemPoint(L, event.lane, x);
        if (boxesOverlap(body, itemBox(L, event.lane, point.x, point.y))) {
          event.dead = true;
          combo = bumpCombo(combo, time - lastCollect);
          lastCollect = time;
          score += event.spec.points;
          audio.collect();
          const label = combo >= 2 ? `+${event.spec.points}  ×${combo}` : `+${event.spec.points}`;
          burst(point.x, point.y, level.accent, label, 'spark');
          ui.setScore(score);
          if (ui.setCombo) ui.setCombo(combo);
        }
      } else if (event.type === 'hazard' && !doomed && iframe <= 0) {
        if (boxesOverlap(body, hazardHitBox(L, event.spec.lane, x))) {
          event.dead = true;
          event.fade = 0.22;
          hearts -= 1;
          iframe = IFRAME;
          shake = reducedMotion ? 0 : 0.28;
          rush *= 0.35;
          combo = 0;
          lastHazardName = event.spec.name;
          audio.hurt();
          burst(x, L.groundY - L.ph * 0.3, '#ef5b3a', '', 'hit');
          ui.setHearts(hearts);
          if (ui.setCombo) ui.setCombo(0);
          ui.announce(`${event.spec.name}. ${hearts} ${hearts === 1 ? 'heart' : 'hearts'} left.`);
          if (hearts <= 0) {
            doomed = true;
            doomTimer = 0.5;
          }
        }
      }
    }

    if (doomed) {
      doomTimer -= dt;
      if (doomTimer <= 0) gameOver();
    }
  }

  function paintLandmarks(L, biome, water, alpha) {
    const plans = draw.LANDMARK_PLAN[biome.id] || [];
    if (!plans.length) return;
    const window = biomeWindow(level, biome.id);
    ctx.save();
    ctx.globalAlpha = alpha;
    for (const mark of plans) {
      const span = window.end - window.start;
      const t = window.start + mark.at * span;
      const x = L.playerX + (t - time) * L.speed * (mark.parallax || 0.2);
      const height = L.ph * (mark.scale || 2);
      if (x < -height || x > L.w + height) continue;
      const base = water ? L.groundY - L.ph * 0.42 : L.groundY;
      draw.drawLandmark(ctx, mark.id, x, base, height, anim, water);
    }
    ctx.restore();
  }

  function paintWorld(L) {
    const sample = Math.min(time, level.durationSec);
    const span = biomeAt(level, sample);
    const next = span.next;
    const t = span.blend;
    const skyTop = draw.mixHex(span.current.sky[0], next && next.sky[0], t);
    const skyBottom = draw.mixHex(span.current.sky[1], next && next.sky[1], t);
    const hill = draw.mixHex(span.current.hill, next && next.hill, t);
    const ground = draw.mixHex(span.current.ground, next && next.ground, t);
    const groundTop = draw.mixHex(span.current.groundTop, next && next.groundTop, t);
    const night = (t > 0.5 && next ? next.night : span.current.night) === true;
    const water = (t > 0.5 && next ? next.water : span.current.water) === true;
    const showing = span.showing;
    const life = showing.life || showing.id;
    const kind = showing.kind || draw.groundKind(showing.id);
    const lowSun = life === 'bangkok' || life === 'chiang' || life === 'desert' || life === 'market';

    const mag = shake > 0 ? 8 * (shake / 0.28) : 0;
    const sx = mag ? (Math.random() - 0.5) * mag * 2 : 0;
    const sy = mag ? (Math.random() - 0.5) * mag * 2 : 0;
    ctx.save();
    ctx.translate(sx, sy);
    draw.fillSkyRich(ctx, L.w, L.h, skyTop, skyBottom, draw.horizonFor(night, skyBottom));
    if (night) {
      draw.drawStars(ctx, L.w, L.h, anim);
      draw.drawMoon(ctx, L.w, L.h, skyTop);
    } else {
      draw.drawSun(ctx, L.w, L.h, anim, lowSun);
    }
    draw.drawClouds(ctx, L.w, L.h, anim, night);
    draw.drawHaze(ctx, L.w, L.groundY - L.h * 0.08, hill, anim, L.speed, L.ph);
    if (!night) draw.drawBirds(ctx, L.w, L.h, anim);

    const farLift = water ? L.ph * 0.15 : 0;
    const farBase = water ? L.groundY - L.ph * 0.2 : L.groundY;
    draw.drawFarStrip(ctx, L.w, farBase, span.current.far, time, L.speed, L.ph, farLift);
    if (t > 0 && next) {
      ctx.save();
      ctx.globalAlpha = t;
      draw.drawFarStrip(ctx, L.w, farBase, next.far, time, L.speed, L.ph, farLift);
      ctx.restore();
    }

    paintLandmarks(L, span.current, Boolean(span.current.water), 1);
    if (t > 0 && next) paintLandmarks(L, next, Boolean(next.water), t);
    draw.drawAmbience(ctx, life, L.w, L.h, L.groundY, anim);
    if (water) draw.drawWater(ctx, L.w, L.groundY, anim, L.ph * 0.8);

    for (const prop of run.scenery) {
      if (prop.layer !== 'mid') continue;
      const x = L.playerX + (prop.t - time) * L.speed * 0.62;
      if (x < -180 || x > L.w + 180) continue;
      const y = prop.water ? L.groundY - L.ph * 0.12 : L.groundY;
      draw.drawMotif(ctx, prop.motif, x, y, L.ph * 1.25 * prop.scale, prop.variant, anim);
    }

    draw.drawGround(ctx, L.w, L.h, L.groundY, ground, groundTop, time, L.speed, kind, rush);
    draw.drawCrowd(ctx, life, L.w, L.groundY, anim, L.speed);

    for (const event of run.events) {
      const x = L.playerX + (event.t - time) * L.speed;
      if (x < -160 || x > L.w + 160) continue;
      if (event.type === 'finish') draw.drawGate(ctx, x, L.groundY, L.ph, level.accent);
      else if (event.type === 'fact') draw.drawShrine(ctx, x, L.groundY, L.ph, level.accent);
      else if (event.type === 'checkpoint') draw.drawCheckpoint(ctx, x, L.groundY, L.ph);
      else if (event.type === 'hazard' && (!event.dead || event.fade > 0)) {
        ctx.save();
        ctx.globalAlpha = event.dead ? Math.max(0, event.fade / 0.22) : 1;
        draw.drawHazard(ctx, event.spec.glyph, hazardArtBox(L, event.spec.lane, x), anim, L.groundY);
        ctx.restore();
      } else if (event.type === 'item' && !event.dead) {
        const point = itemPoint(L, event.lane, x);
        draw.drawItem(ctx, event.spec.glyph, point.x, point.y, L.ph * 0.42, anim, point.pop);
      }
    }

    const pose = foot > 3 ? 'jump' : duckingNow() ? 'duck' : 'run';
    const alpha = iframe > 0 && Math.floor(anim * 12) % 2 === 0 ? 0.28 : 1;
    const fx = squashStretch({ pose, vy, ph: L.ph, land: landPulse > 0 ? landPulse / 0.16 : 0 });
    draw.drawTraveller(ctx, L.playerX, L.groundY - foot, L.ph, pose, anim, alpha, fx, castId);
    draw.drawForeground(ctx, life, L.w, L.groundY, anim, L.speed, L.ph);
    if (rush > 0.3) draw.drawMotion(ctx, L.w, L.groundY, rush, anim);

    if (debug) {
      ctx.save();
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1;
      const body = playerBox(L);
      ctx.strokeRect(body.x, body.y, body.w, body.h);
      for (const event of run.events) {
        if (event.dead || (event.type !== 'hazard' && event.type !== 'item')) continue;
        const x = L.playerX + (event.t - time) * L.speed;
        const box =
          event.type === 'hazard'
            ? hazardHitBox(L, event.spec.lane, x)
            : itemBox(L, event.lane, itemPoint(L, event.lane, x).x, itemPoint(L, event.lane, x).y);
        ctx.strokeRect(box.x, box.y, box.w, box.h);
      }
      ctx.restore();
    }

    ctx.font = '700 16px Trebuchet MS, Segoe UI, sans-serif';
    ctx.textAlign = 'left';
    for (const p of particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      if (p.text) {
        ctx.fillStyle = '#1c2430';
        ctx.strokeStyle = '#fffaf2';
        ctx.lineWidth = 3;
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillText(p.text, p.x, p.y);
      } else if (p.kind === 'dust') {
        draw.drawDust(ctx, p);
      } else {
        draw.drawSpark(ctx, p);
      }
      ctx.restore();
    }

    if (iframe > 1.05) {
      ctx.fillStyle = 'rgba(255, 90, 70, 0.16)';
      ctx.fillRect(0, 0, L.w, L.h);
    }
    ctx.restore();
  }

  function render() {
    resize();
    const L = layout();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (mode === 'map' || !level || !run) {
      const clock = reducedMotion ? 0.4 : anim;
      draw.drawMapScene(ctx, L.w, L.h, clock, pins, castId);
      return;
    }
    paintWorld(L);
  }

  function frame(now) {
    try {
      if (resetClock) {
        last = now;
        resetClock = false;
      }
      if (!last) last = now;
      let dt = (now - last) / 1000;
      last = now;
      if (dt < 0) dt = 0;
      if (dt > 0.1) dt = 0.1;

      if (document.hidden && mode === 'play') {
        mode = 'paused';
        ui.showPause();
      }

      if (mode === 'play' && run) {
        let left = dt;
        while (left > 0) {
          const slice = Math.min(left, 1 / 90);
          time += slice;
          anim += slice;
          step(slice);
          left -= slice;
          if (mode !== 'play') break;
        }
        syncHud(layout());
      } else if (mode === 'map' && !reducedMotion) {
        anim += dt;
      }

      if (mode !== 'over' && (mode === 'map' || level)) {
        const theme = mode === 'map' || !level ? 'map' : level.music || 'map';
        guard(() => audio.tickMusic(theme));
      }
      render();
    } catch (err) {
      if (recoverable(err)) {
        remember(err);
      } else {
        cancelAnimationFrame(raf);
        ui.fatal(err && err.message ? err.message : 'Something went wrong.');
        return;
      }
    }
    raf = requestAnimationFrame(frame);
  }

  function start(next, opts = {}) {
    level = next;
    const asked = Number(opts.seed);
    const seed =
      Number.isFinite(asked) && asked >= 1 && asked <= 0x7fffffff
        ? Math.floor(asked)
        : Math.floor(Math.random() * 0x7fffffff) || 1;
    runSeed = seed;
    run = buildRun(level, mulberry32(seed));
    ceiling = scoreCeiling(run.events, level.heartBonus, HEARTS);
    score = 0;
    hearts = HEARTS;
    foot = 0;
    vy = 0;
    coyote = 0;
    jumpBuf = 0;
    jumpCut = false;
    iframe = 0;
    shake = 0;
    doomed = false;
    doomTimer = 0;
    lastHazardName = '';
    bannerUntil = 0;
    combo = 0;
    lastCollect = -99;
    landPulse = 0;
    dustClock = 0;
    rush = 0;
    introBiome = '';
    wasAir = false;
    particles.length = 0;
    const saved = resumePoint(run.events, level.durationSec, opts.checkpoint);
    const requested = Number(opts.at);
    const resumeAt = saved ? saved.time : Number.isFinite(requested) ? requested : 0;
    const span = Number(level.durationSec);
    const limit = Number.isFinite(span) ? Math.max(0, span - 0.5) : 0;
    const at = Math.max(0, Math.min(limit, resumeAt));
    time = at;
    practice = Boolean(opts.practice);
    if (saved) {
      score = saved.score;
      applyCheckpoint(run.events, at);
    } else if (at > 0) {
      practice = true;
      applyCheckpoint(run.events, at);
    }
    hintOn = at === 0;
    mode = 'play';
    resetClock = true;
    noted = '';
    const marks = run.events.filter((event) => event.type === 'checkpoint').map((event) => event.t / level.durationSec);
    guard(() => ui.prepareRun({ accent: level.accent, practice }));
    guard(() => ui.setScore(score));
    guard(() => ui.setMarks(marks));
    guard(() => ui.setHearts(HEARTS));
    guard(() => ui.setFact(null));
    guard(() => ui.setBiome(biomeAt(level, Math.min(time, level.durationSec)).showing.name));
    guard(() => ui.setProgress(level.durationSec ? time / level.durationSec : 0));
    guard(() => ui.setHint(hintOn));
    if (ui.setCombo) guard(() => ui.setCombo(0));
  }

  function showMap() {
    mode = 'map';
    level = null;
    run = null;
    resetClock = true;
    ui.showMap();
  }

  function holdMap() {
    mode = 'map';
    level = null;
    run = null;
    resetClock = true;
  }

  function pause() {
    if (mode !== 'play') return;
    mode = 'paused';
    ui.showPause();
  }

  function resume() {
    if (mode !== 'paused') return;
    mode = 'play';
    resetClock = true;
    ui.resumeRun();
  }

  raf = requestAnimationFrame(frame);

  return {
    input,
    start,
    showMap,
    holdMap,
    pause,
    resume,
    setCharacter(id) {
      castId = characterById(id).id;
    },
    setMapPins(next) {
      pins = next || [];
    },
    character: () => castId,
    mode: () => mode,
    destroy() {
      cancelAnimationFrame(raf);
    },
  };
}
