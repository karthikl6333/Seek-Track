/**
 * Jump numbers shared by the game and the hurdle test.
 * A tap still clears every ground hurdle. Holding the button goes higher.
 */

import { boxesOverlap } from './run.js';

export const COYOTE = 0.1;
export const JUMP_BUFFER = 0.12;
export const IFRAME = 1.25;

export function gravityOf(h) {
  return h * 1.48;
}

export function fullRise(ph) {
  return ph * 1.42;
}

export function shortRise(ph) {
  return ph * 0.78;
}

export function takeoffSpeed(h, ph) {
  return Math.sqrt(2 * gravityOf(h) * fullRise(ph));
}

export function shortHopSpeed(h, ph) {
  return Math.sqrt(2 * gravityOf(h) * shortRise(ph));
}

/** Seconds from takeoff to the top of a tap (false) or a held jump (true). */
export function apexDelay(h, ph, hold) {
  const v = hold ? takeoffSpeed(h, ph) : shortHopSpeed(h, ph);
  return v / gravityOf(h);
}

/** How long a held jump stays off the ground. */
export function fullAirtime(h, ph) {
  return (2 * takeoffSpeed(h, ph)) / gravityOf(h);
}

const ART = {
  low: { w: 0.62, h: 0.24, lift: 0 },
  mid: { w: 0.74, h: 0.48, lift: 0 },
  high: { w: 0.5, h: 0.4, lift: 0.66 },
};

export function hazardArtBox(L, lane, centerX) {
  const spec = ART[lane] || ART.mid;
  const w = spec.w * L.ph;
  const h = spec.h * L.ph;
  const y = L.groundY - (spec.lift * L.ph + h);
  return { x: centerX - w / 2, y, w, h };
}

/** Clearly inside the painted obstacle, so a close jump still counts. */
export function hazardHitBox(L, lane, centerX) {
  const art = hazardArtBox(L, lane, centerX);
  const dx = art.w * 0.26;
  const dy = art.h * 0.22;
  return { x: art.x + dx, y: art.y + dy, w: art.w - dx * 2, h: art.h - dy * 2 };
}

/**
 * Torso only: narrower than the sprite, and the shoes may overlap the art.
 * `hitScale` makes a taller traveller a little taller. Width stays the same.
 */
export function playerHitBox(L, foot, ducking, hitScale = 1) {
  const scale = hitScale || 1;
  const footY = L.groundY - foot;
  const height = (ducking ? 0.36 : 0.58) * L.ph * scale;
  const width = 0.22 * L.ph;
  const inset = 0.07 * L.ph;
  return { x: L.playerX - width / 2, y: footY - height - inset, w: width, h: height };
}

export function layoutFor(w, h) {
  const ph = Math.max(58, Math.min(108, h * 0.155));
  const groundY = Math.min(h * 0.72, h - 108);
  const playerX = Math.max(84, Math.min(w * 0.24, w * 0.4));
  const speed = Math.max(160, w * 0.34);
  return { w, h, ph, groundY, playerX, speed };
}

/**
 * One hurdle comes at the player. `lead` is how long before it arrives that
 * the jump button goes down. A tap releases 30ms later. Returns true when the
 * body never touches the hurdle's hit box.
 */
export function jumpClearsHazard(L, lane, { hold = false, lead, hitScale = 1 }) {
  const dt = 1 / 120;
  const g = gravityOf(L.h);
  const full = takeoffSpeed(L.h, L.ph);
  const shortV = shortHopSpeed(L.h, L.ph);
  let t = -lead - 0.2;
  let foot = 0;
  let vy = 0;
  let coyote = COYOTE;
  let jumpBuf = 0;
  let jumpCut = false;
  let jumped = false;
  let held = false;
  let pressed = false;
  const end = 0.55;
  while (t < end) {
    if (!pressed && t >= -lead) {
      pressed = true;
      jumpBuf = JUMP_BUFFER;
      held = true;
    }
    if (pressed && !hold && t >= -lead + 0.03) held = false;
    const onGround = foot <= 0.5 && vy <= 0;
    if (onGround) {
      foot = 0;
      vy = 0;
      coyote = COYOTE;
      jumpCut = false;
    } else {
      coyote -= dt;
    }
    if (jumpBuf > 0 && coyote > 0 && !jumped) {
      vy = full;
      foot = Math.max(foot, 1);
      coyote = 0;
      jumpBuf = 0;
      jumpCut = false;
      jumped = true;
    } else {
      jumpBuf -= dt;
    }
    if (!held && vy > shortV && !jumpCut) {
      vy = shortV;
      jumpCut = true;
    }
    if (foot > 0 || vy > 0) {
      vy -= g * dt;
      foot += vy * dt;
      if (foot <= 0) {
        foot = 0;
        vy = 0;
      }
    }
    const centerX = L.playerX + -t * L.speed;
    if (boxesOverlap(playerHitBox(L, foot, false, hitScale), hazardHitBox(L, lane, centerX))) return false;
    t += dt;
  }
  return jumped;
}

/** Ducking puts the hit box under a high sign for the whole time it passes. */
export function duckClearsHazard(L, lane, hitScale = 1) {
  const dt = 1 / 120;
  let t = -0.35;
  while (t < 0.35) {
    const centerX = L.playerX + -t * L.speed;
    if (boxesOverlap(playerHitBox(L, 0, true, hitScale), hazardHitBox(L, lane, centerX))) return false;
    t += dt;
  }
  return true;
}
