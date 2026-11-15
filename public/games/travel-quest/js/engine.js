/**
 * Side-scrolling run. The traveller stays put; the country scrolls to them.
 * A level file describes the trip. This file only moves, collides, and paints.
 */
import { scoreCeiling, starsFor } from './progress.js';
import { biomeAt, boxesOverlap, buildRun, mulberry32 } from './run.js';
import * as draw from './draw.js';

const HEARTS = 3;

function deflate(box, margin) {
  const dx = box.w * margin;
  const dy = box.h * margin;
  return { x: box.x + dx, y: box.y + dy, w: box.w - dx * 2, h: box.h - dy * 2 };
}

function inflate(box, margin) {
  const dx = box.w * margin;
  const dy = box.h * margin;
  return { x: box.x - dx, y: box.y - dy, w: box.w + dx * 2, h: box.h + dy * 2 };
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
  let doomed = false;
  let doomTimer = 0;
  let lastHazardName = '';
  let bannerUntil = 0;
  let hintOn = false;
  let dpr = 1;
  const particles = [];
  const debug = new URLSearchParams(window.location.search).get('debug') === '1';

  function layout() {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    const ph = Math.max(58, Math.min(108, h * 0.155));
    const groundY = Math.min(h * 0.72, h - 108);
    const playerX = Math.max(84, Math.min(w * 0.24, w * 0.4));
    const speed = Math.max(160, w * 0.34);
    return { w, h, ph, groundY, playerX, speed };
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
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

  function playerBox(L) {
    const footY = L.groundY - foot;
    const height = duckingNow() ? L.ph * 0.46 : L.ph * 0.92;
    const width = L.ph * 0.36;
    return deflate(
      { x: L.playerX - width / 2, y: footY - height, w: width, h: height },
      0.06,
    );
  }

  function hazardBox(L, lane, centerX) {
    const table = {
      low: { w: 0.58, h: 0.2, lift: 0 },
      mid: { w: 0.66, h: 0.42, lift: 0 },
      high: { w: 0.46, h: 0.36, lift: 0.62 },
    };
    const spec = table[lane] || table.mid;
    const w = spec.w * L.ph;
    const h = spec.h * L.ph;
    const y = L.groundY - (spec.lift * L.ph + h);
    return deflate({ x: centerX - w / 2, y, w, h }, 0.04);
  }

  function itemCenterY(L, lane) {
    const lift = lane === 'air' ? L.ph * 1.32 : L.ph * 0.4;
    return L.groundY - lift;
  }

  function itemBox(L, lane, centerX) {
    const s = L.ph * 0.32;
    const y = itemCenterY(L, lane) - s / 2;
    return inflate({ x: centerX - s / 2, y, w: s, h: s }, 0.22);
  }

  function burst(x, y, color, text) {
    if (text) {
      particles.push({ x, y, vx: 18, vy: -42, life: 0.7, max: 0.7, color, text, grav: 0 });
    }
    if (reducedMotion || text) return;
    for (let i = 0; i < 6; i += 1) {
      particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 160,
        vy: -30 - Math.random() * 110,
        life: 0.4,
        max: 0.4,
        color,
        text: '',
        grav: 360,
      });
    }
    if (particles.length > 48) particles.splice(0, particles.length - 48);
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
      const name = biomeAt(level, time).showing.name;
      ui.setBiome(name);
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
    const gravity = L.h * 2.05;
    const rise = L.ph * 0.82;
    const jumpV = Math.sqrt(2 * gravity * rise);

    const onGround = foot <= 0.5 && vy <= 0;
    if (onGround) {
      foot = 0;
      vy = 0;
      coyote = 0.12;
      jumpCut = false;
    } else {
      coyote -= dt;
    }

    if (input.jumpQueued) {
      jumpBuf = 0.14;
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
      audio.jump();
    }
    if (!input.jumpHeld && vy > 0 && !jumpCut) {
      vy *= 0.68;
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

    if (iframe > 0) iframe -= dt;
    if (shake > 0) shake -= dt;

    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.grav * dt;
      if (p.life <= 0) particles.splice(i, 1);
    }

    const body = playerBox(L);
    for (const event of run.events) {
      const x = L.playerX + (event.t - time) * L.speed;
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
      if (event.dead) continue;
      if (x < -L.ph * 2 || x > L.w + L.ph * 2) continue;
      if (event.type === 'item') {
        if (boxesOverlap(body, itemBox(L, event.lane, x))) {
          event.dead = true;
          score += event.spec.points;
          audio.collect();
          burst(x, itemCenterY(L, event.lane), level.accent, `+${event.spec.points}`);
          ui.setScore(score);
        }
      } else if (event.type === 'hazard' && !doomed && iframe <= 0) {
        if (boxesOverlap(body, hazardBox(L, event.spec.lane, x))) {
          event.dead = true;
          hearts -= 1;
          iframe = 1.35;
          shake = reducedMotion ? 0 : 0.22;
          lastHazardName = event.spec.name;
          audio.hurt();
          ui.setHearts(hearts);
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

    const mag = shake > 0 ? 5 * (shake / 0.22) : 0;
    const sx = mag ? (Math.random() - 0.5) * mag * 2 : 0;
    const sy = mag ? (Math.random() - 0.5) * mag * 2 : 0;
    ctx.save();
    ctx.translate(sx, sy);
    draw.fillSky(ctx, L.w, L.h, skyTop, skyBottom);
    if (night) {
      draw.drawStars(ctx, L.w, L.h, anim);
      draw.drawMoon(ctx, L.w, L.h, skyTop);
    } else {
      draw.drawSun(ctx, L.w, L.h);
      draw.drawBirds(ctx, L.w, L.h, anim);
    }
    draw.drawClouds(ctx, L.w, L.h, anim, night);
    draw.drawHills(ctx, L.w, L.groundY, hill, anim);
    if (water) draw.drawWater(ctx, L.w, L.groundY, anim);

    for (const prop of run.scenery) {
      if (prop.layer !== 'far') continue;
      const x = L.playerX + (prop.t - time) * L.speed * 0.28;
      if (x < -180 || x > L.w + 180) continue;
      draw.drawMotif(ctx, prop.motif, x, L.groundY - 4, L.ph * 1.7 * prop.scale, prop.variant, anim);
    }
    draw.drawGround(ctx, L.w, L.h, L.groundY, ground, groundTop, time, L.speed);
    for (const prop of run.scenery) {
      if (prop.layer !== 'mid') continue;
      const x = L.playerX + (prop.t - time) * L.speed * 0.62;
      if (x < -160 || x > L.w + 160) continue;
      draw.drawMotif(ctx, prop.motif, x, L.groundY, L.ph * 1.25 * prop.scale, prop.variant, anim);
    }

    for (const event of run.events) {
      const x = L.playerX + (event.t - time) * L.speed;
      if (x < -140 || x > L.w + 140) continue;
      if (event.type === 'finish') draw.drawGate(ctx, x, L.groundY, L.ph, level.accent);
      else if (event.type === 'fact') draw.drawShrine(ctx, x, L.groundY, L.ph, level.accent);
      else if (event.type === 'hazard' && !event.dead) {
        draw.drawHazard(ctx, event.spec.glyph, hazardBox(L, event.spec.lane, x), anim, L.groundY);
      } else if (event.type === 'item' && !event.dead) {
        draw.drawItem(ctx, event.spec.glyph, x, itemCenterY(L, event.lane), L.ph * 0.42, anim);
      }
    }

    const pose = foot > 3 ? 'jump' : duckingNow() ? 'duck' : 'run';
    const alpha = iframe > 0 && Math.floor(iframe * 14) % 2 === 0 ? 0.35 : 1;
    draw.drawTraveller(ctx, L.playerX, L.groundY - foot, L.ph, pose, anim, alpha);

    if (debug) {
      ctx.save();
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1;
      const body = playerBox(L);
      ctx.strokeRect(body.x, body.y, body.w, body.h);
      for (const event of run.events) {
        if (event.dead || (event.type !== 'hazard' && event.type !== 'item')) continue;
        const x = L.playerX + (event.t - time) * L.speed;
        const box = event.type === 'hazard' ? hazardBox(L, event.spec.lane, x) : itemBox(L, event.lane, x);
        ctx.strokeRect(box.x, box.y, box.w, box.h);
      }
      ctx.restore();
    }

    ctx.font = '700 16px Trebuchet MS, Segoe UI, sans-serif';
    ctx.textAlign = 'left';
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      if (p.text) {
        ctx.fillStyle = '#1c2430';
        ctx.fillText(p.text, p.x, p.y);
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, 5, 5);
      }
    }
    ctx.restore();
  }

  function render() {
    resize();
    const L = layout();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (mode === 'map' || !level || !run) {
      draw.drawMapScene(ctx, L.w, L.h, anim);
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
      } else if (mode === 'map') {
        anim += dt;
      }

      if (mode !== 'over' && (mode === 'map' || level)) {
        const night = level && mode !== 'map' ? biomeAt(level, time).showing.night : false;
        audio.tickMusic(night ? 'night' : 'day');
      }
      render();
    } catch (err) {
      cancelAnimationFrame(raf);
      ui.fatal(err && err.message ? err.message : 'Something went wrong.');
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function start(next, opts = {}) {
    level = next;
    const seed = opts.seed || Math.floor(Math.random() * 0x7fffffff) || 1;
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
    particles.length = 0;
    practice = Boolean(opts.practice);
    const at = Math.max(0, Math.min(level.durationSec - 0.5, Number(opts.at) || 0));
    time = at;
    if (at > 0) {
      practice = true;
      for (const event of run.events) {
        if (event.t < at - 0.05 && event.type !== 'finish') {
          event.dead = true;
          event.fired = true;
        }
      }
    }
    hintOn = at === 0;
    mode = 'play';
    resetClock = true;
    ui.prepareRun({ accent: level.accent, practice });
    ui.setScore(0);
    ui.setHearts(HEARTS);
    ui.setFact(null);
    ui.setBiome(biomeAt(level, time).showing.name);
    ui.setProgress(time / level.durationSec);
    ui.setHint(hintOn);
  }

  function showMap() {
    mode = 'map';
    level = null;
    run = null;
    resetClock = true;
    ui.showMap();
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
    pause,
    resume,
    mode: () => mode,
    destroy() {
      cancelAnimationFrame(raf);
    },
  };
}
