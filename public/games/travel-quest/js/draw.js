/**
 * Souvenirs, hurdles, and the explorer. World art lives in scenery.js.
 * The explorer is the approved drawing; jump and duck only transform it.
 */
import {
  LANDMARK_PLAN,
  MOTIF_DRAW,
  clearArtCache,
  drawAmbience,
  drawBirds,
  drawClouds,
  drawCrowd,
  drawDust,
  drawFarStrip,
  drawForeground,
  drawGround,
  drawHaze,
  drawLandmark,
  drawLanternShape,
  drawMapBackdrop,
  drawMapPin,
  drawMoon,
  drawMotion,
  drawMotif,
  drawSpark,
  drawStars,
  drawSun,
  drawWater,
  fillSky,
  fillSkyRich,
  groundKind,
  horizonFor,
  mixHex,
  roundRect,
  softShadow,
} from './scenery.js';
import { characterById } from './cast.js';
import { EXTRA_HAZARDS, EXTRA_ITEMS } from './glyphs.js';

export {
  LANDMARK_PLAN,
  MOTIF_DRAW,
  clearArtCache,
  drawAmbience,
  drawBirds,
  drawClouds,
  drawCrowd,
  drawDust,
  drawFarStrip,
  drawForeground,
  drawGround,
  drawHaze,
  drawLandmark,
  drawMapBackdrop,
  drawMoon,
  drawMotion,
  drawMotif,
  drawSpark,
  drawStars,
  drawSun,
  drawWater,
  fillSky,
  fillSkyRich,
  groundKind,
  horizonFor,
  mixHex,
  softShadow,
};

function ink(ctx, w) {
  ctx.strokeStyle = '#2a2118';
  ctx.lineWidth = w || 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

function fillInk(ctx, color, w) {
  ctx.fillStyle = color;
  ctx.fill();
  ink(ctx, w || 2);
}

function highlight(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(x, y, w, h);
}

function bob(time, x) {
  return Math.sin(time * 3 + x * 0.01) * 3;
}

function drawMango(ctx, x, y, size, time) {
  ctx.save();
  ctx.translate(x, y + bob(time, x));
  const s = size;
  ctx.fillStyle = '#f4e2c4';
  ctx.beginPath();
  ctx.ellipse(0, s * 0.12, s * 0.36, s * 0.2, 0, 0, Math.PI * 2);
  fillInk(ctx, '#f4e2c4', 1.6);
  ctx.fillStyle = '#fffaf2';
  ctx.beginPath();
  ctx.ellipse(0, s * 0.02, s * 0.2, s * 0.1, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#f5b423';
  ctx.beginPath();
  ctx.ellipse(s * 0.04, -s * 0.12, s * 0.22, s * 0.11, -0.5, 0, Math.PI * 2);
  fillInk(ctx, '#f5b423', 1.4);
  highlight(ctx, -s * 0.08, -s * 0.16, s * 0.08, s * 0.04);
  ctx.fillStyle = '#2f9e5a';
  ctx.beginPath();
  ctx.ellipse(-s * 0.16, -s * 0.16, s * 0.09, s * 0.045, -0.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawOrchid(ctx, x, y, size, time) {
  ctx.save();
  ctx.translate(x, y + bob(time, x));
  ctx.strokeStyle = '#2f9e5a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, size * 0.42);
  ctx.quadraticCurveTo(size * 0.08, size * 0.2, 0, 0);
  ctx.stroke();
  const petals = ['#d46adf', '#b94ec8', '#e7a0ee'];
  for (let i = 0; i < 5; i += 1) {
    ctx.save();
    ctx.rotate((i / 5) * Math.PI * 2);
    ctx.fillStyle = petals[i % 3];
    ctx.beginPath();
    ctx.ellipse(0, -size * 0.22, size * 0.1, size * 0.18, 0, 0, Math.PI * 2);
    fillInk(ctx, petals[i % 3], 1.2);
    ctx.restore();
  }
  ctx.fillStyle = '#f2c14e';
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff6d2';
  ctx.beginPath();
  ctx.arc(-size * 0.02, -size * 0.02, size * 0.03, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawElephant(ctx, x, y, size, time) {
  ctx.save();
  ctx.translate(x, y + bob(time, x));
  const s = size * 0.46;
  ctx.fillStyle = '#f2c14e';
  ctx.beginPath();
  ctx.arc(0, 0, s, 0, Math.PI * 2);
  fillInk(ctx, '#f2c14e', 2);
  highlight(ctx, -s * 0.35, -s * 0.45, s * 0.4, s * 0.16);
  ctx.fillStyle = '#6b4a32';
  ctx.beginPath();
  ctx.ellipse(-s * 0.05, s * 0.1, s * 0.36, s * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(s * 0.28, 0, s * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#6b4a32';
  ctx.lineWidth = Math.max(2, s * 0.14);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(s * 0.4, s * 0.08);
  ctx.quadraticCurveTo(s * 0.66, s * 0.28, s * 0.34, s * 0.42);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(s * 0.32, -s * 0.04, s * 0.04, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBanhMi(ctx, x, y, size, time) {
  ctx.save();
  ctx.translate(x, y + bob(time, x));
  ctx.rotate(-0.4);
  const s = size;
  roundRect(ctx, -s * 0.42, -s * 0.16, s * 0.84, s * 0.32, s * 0.16);
  fillInk(ctx, '#f0c14a', 1.6);
  highlight(ctx, -s * 0.3, -s * 0.12, s * 0.4, s * 0.05);
  ctx.fillStyle = '#3aa06a';
  ctx.fillRect(-s * 0.22, -s * 0.05, s * 0.44, s * 0.06);
  ctx.fillStyle = '#e07a4c';
  ctx.fillRect(-s * 0.16, s * 0.02, s * 0.28, s * 0.05);
  ctx.fillStyle = '#fff6d2';
  for (let i = 0; i < 4; i += 1) ctx.fillRect(-s * 0.2 + i * s * 0.12, -s * 0.14, s * 0.04, s * 0.03);
  ctx.restore();
}

function drawLanternItem(ctx, x, y, size, time) {
  ctx.save();
  ctx.translate(0, bob(time, x));
  drawLanternShape(ctx, x, y, size * 0.52, '#e23d3d');
  ctx.restore();
}

function drawHat(ctx, x, y, size, time) {
  ctx.save();
  ctx.translate(x, y + bob(time, x));
  const s = size;
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.42);
  ctx.quadraticCurveTo(s * 0.2, -s * 0.05, s * 0.48, s * 0.22);
  ctx.lineTo(-s * 0.48, s * 0.22);
  ctx.quadraticCurveTo(-s * 0.2, -s * 0.05, 0, -s * 0.42);
  ctx.closePath();
  fillInk(ctx, '#f3e2b0', 1.6);
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-s * 0.12, -s * 0.16);
  ctx.lineTo(-s * 0.02, s * 0.12);
  ctx.stroke();
  ctx.strokeStyle = '#e25b45';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-s * 0.22, s * 0.02);
  ctx.lineTo(s * 0.22, s * 0.02);
  ctx.stroke();
  ctx.restore();
}

export const ITEM_DRAW = {
  mango: drawMango,
  orchid: drawOrchid,
  elephant: drawElephant,
  banhmi: drawBanhMi,
  lantern: drawLanternItem,
  hat: drawHat,
  ...EXTRA_ITEMS,
};

export function drawItem(ctx, glyph, x, y, size, time, pop) {
  const draw = ITEM_DRAW[glyph];
  if (!draw) return;
  const scale = pop || 1;
  softShadow(ctx, x, y + size * 0.48, size * 0.34 * scale, size * 0.1);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.translate(-x, -y);
  draw(ctx, x, y, size, time);
  ctx.restore();
}

function drawPothole(ctx, box, _time, groundY) {
  const cx = box.x + box.w / 2;
  ctx.save();
  ctx.fillStyle = '#8a7058';
  ctx.beginPath();
  ctx.ellipse(cx, groundY + 2, box.w * 0.62, box.h * 1.05, 0, 0, Math.PI * 2);
  ctx.fill();
  ink(ctx, 1.5);
  ctx.fillStyle = '#2c2118';
  ctx.beginPath();
  ctx.ellipse(cx, groundY + 4, box.w * 0.4, box.h * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#c4a574';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - box.w * 0.3, groundY);
  ctx.lineTo(cx - box.w * 0.05, groundY - box.h * 0.2);
  ctx.moveTo(cx + box.w * 0.15, groundY + 1);
  ctx.lineTo(cx + box.w * 0.32, groundY - box.h * 0.15);
  ctx.stroke();
  ctx.restore();
}

function drawWheel(ctx, x, y, r, spin) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#d5dae2';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(spin) * (r - 2), Math.sin(spin) * (r - 2));
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(spin + 1.6) * (r - 2), Math.sin(spin + 1.6) * (r - 2));
  ctx.stroke();
  ctx.restore();
}

function drawScooter(ctx, box, time, groundY) {
  const cx = box.x + box.w / 2;
  ctx.save();
  ctx.translate(cx, groundY);
  const s = box.h / 52;
  ctx.scale(s, s);
  const spin = time * 14;
  drawWheel(ctx, -18, -8, 8, spin);
  drawWheel(ctx, 18, -8, 8, spin);
  ctx.strokeStyle = '#d9dde3';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-18, -8);
  ctx.lineTo(18, -8);
  ctx.lineTo(22, -30);
  ctx.stroke();
  roundRect(ctx, -20, -28, 32, 16, 4);
  fillInk(ctx, '#3aa6d8', 1.4);
  highlight(ctx, -16, -26, 22, 4);
  ctx.fillStyle = '#f3c19a';
  ctx.beginPath();
  ctx.arc(-2, -36, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e25b45';
  ctx.beginPath();
  ctx.arc(-2, -38, 7, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#222';
  ctx.fillRect(16, -14, 6, 4);
  ctx.restore();
}

function drawSign(ctx, box, time, groundY) {
  const cx = box.x + box.w / 2;
  const swing = Math.sin(time * 2 + cx) * 2;
  ctx.save();
  ctx.strokeStyle = '#6b3a22';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx, groundY);
  ctx.lineTo(cx, box.y + box.h);
  ctx.stroke();
  ctx.translate(swing, 0);
  roundRect(ctx, box.x, box.y, box.w, box.h, 6);
  fillInk(ctx, '#f2c14e', 2);
  highlight(ctx, box.x + 4, box.y + 3, box.w - 8, 4);
  ctx.fillStyle = '#e25b45';
  ctx.beginPath();
  ctx.arc(cx, box.y + box.h * 0.58, Math.min(box.w, box.h) * 0.16, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = '#1c2430';
  ctx.fillRect(box.x + box.w * 0.2, box.y + box.h * 0.22, box.w * 0.6, 3);
  ctx.restore();
}

function drawPuddle(ctx, box, time, groundY) {
  const cx = box.x + box.w / 2;
  ctx.save();
  ctx.fillStyle = '#3d93c8';
  ctx.beginPath();
  ctx.ellipse(cx, groundY + 1, box.w * 0.62, box.h * 0.95, 0, 0, Math.PI * 2);
  fillInk(ctx, '#3d93c8', 1.4);
  ctx.fillStyle = '#8fd4ff';
  ctx.beginPath();
  ctx.ellipse(cx - box.w * 0.08, groundY - 1, box.w * 0.28, box.h * 0.4, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  const shift = Math.sin(time * 3) * 2;
  ctx.ellipse(cx - box.w * 0.1, groundY - 1 + shift, box.w * 0.18, box.h * 0.22, -0.6, Math.PI * 1.1, Math.PI * 1.9);
  ctx.stroke();
  ctx.restore();
}

function drawBuffalo(ctx, box, time, groundY) {
  ctx.save();
  ctx.translate(box.x + box.w / 2, groundY);
  const s = box.h / 56;
  ctx.scale(s, s);
  const step = Math.sin(time * 10);
  ctx.fillStyle = '#5c6570';
  ctx.fillRect(-22, -18, 7, 18 + step * 2);
  ctx.fillRect(-8, -18, 7, 18 - step * 2);
  ctx.fillRect(8, -18, 7, 18 + step * 2);
  ctx.fillRect(20, -18, 7, 18 - step * 2);
  ctx.beginPath();
  ctx.ellipse(0, -32, 28, 16, 0, 0, Math.PI * 2);
  fillInk(ctx, '#5c6570', 1.5);
  highlight(ctx, -16, -40, 20, 5);
  ctx.beginPath();
  ctx.ellipse(26, -38, 12, 10, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ink(ctx, 1.3);
  ctx.strokeStyle = '#f3e6c4';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(18, -46);
  ctx.quadraticCurveTo(6, -62, 8, -46);
  ctx.moveTo(30, -46);
  ctx.quadraticCurveTo(44, -62, 38, -44);
  ctx.stroke();
  ctx.fillStyle = '#1c2430';
  ctx.beginPath();
  ctx.arc(30, -40, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e3a008';
  ctx.beginPath();
  ctx.arc(8, -34, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHangLantern(ctx, box, time) {
  const cx = box.x + box.w / 2;
  const swing = Math.sin(time * 2.2 + cx * 0.01) * 4;
  ctx.save();
  ctx.strokeStyle = '#f2d48a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 40, box.y - 28);
  ctx.quadraticCurveTo(cx, box.y - 6, cx + swing, box.y + 4);
  ctx.stroke();
  drawLanternShape(ctx, cx + swing, box.y + box.h * 0.55, Math.min(box.w, box.h) * 0.7, '#e23d3d');
  ctx.restore();
}

export const HAZARD_DRAW = {
  pothole: drawPothole,
  scooter: drawScooter,
  sign: drawSign,
  puddle: drawPuddle,
  buffalo: drawBuffalo,
  hanglantern: drawHangLantern,
  ...EXTRA_HAZARDS,
};

export function drawHazard(ctx, glyph, box, time, groundY) {
  const draw = HAZARD_DRAW[glyph];
  if (!draw) return;
  softShadow(ctx, box.x + box.w / 2, groundY + 3, box.w * 0.46, 5);
  draw(ctx, box, time, groundY);
}

function star(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = x + Math.cos(a) * radius;
    const py = y + Math.sin(a) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

export function drawGate(ctx, x, groundY, h, accent) {
  ctx.save();
  ctx.translate(x, groundY);
  softShadow(ctx, 0, 2, h * 0.35, h * 0.06);
  const top = -h * 0.95;
  ctx.strokeStyle = accent;
  ctx.fillStyle = accent;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-26, 0);
  ctx.lineTo(-26, top);
  ctx.moveTo(26, 0);
  ctx.lineTo(26, top);
  ctx.stroke();
  roundRect(ctx, -44, top - 22, 88, 22, 5);
  ctx.fill();
  ctx.fillStyle = '#fff6d2';
  roundRect(ctx, -40, top - 18, 80, 8, 3);
  ctx.fill();
  ctx.fillStyle = '#fff';
  star(ctx, 0, top - 8, 7);
  ctx.restore();
}

export function drawShrine(ctx, x, groundY, h, accent) {
  ctx.save();
  ctx.translate(x, groundY);
  softShadow(ctx, 0, 2, h * 0.16, h * 0.04);
  ctx.fillStyle = accent;
  ctx.fillRect(-5, -h * 0.55, 10, h * 0.55);
  ctx.beginPath();
  ctx.arc(0, -h * 0.62, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  star(ctx, 0, -h * 0.62, 5);
  ctx.restore();
}

const spriteCache = {};

function spriteUrl(id, pose) {
  try {
    return new URL(`../assets/${id}-${pose}.png`, import.meta.url).href;
  } catch {
    return '';
  }
}

function ensureSprites(id) {
  if (spriteCache[id] || typeof Image === 'undefined') return;
  const pair = {};
  for (const pose of ['idle', 'run']) {
    const img = new Image();
    img.decoding = 'async';
    img.src = spriteUrl(id, pose);
    pair[pose] = img;
  }
  spriteCache[id] = pair;
}

function spriteReady(img) {
  return Boolean(img && img.complete && img.naturalWidth);
}

function paintSprite(ctx, img, anchor, dw, dh, top) {
  ctx.drawImage(img, -dw * anchor, top, dw, dh);
}

function drawLoaded(ctx, img, anchor, h, pose, time, split) {
  const aspect = img.naturalWidth / img.naturalHeight;
  const dw = h * aspect;
  const dh = h;
  ctx.save();
  if (pose === 'idle') {
    ctx.translate(0, Math.sin(time * 2.3) * h * 0.012);
    paintSprite(ctx, img, anchor, dw, dh, -dh);
  } else if (pose === 'jump') {
    ctx.rotate(-0.2);
    ctx.translate(0, -h * 0.04);
    paintSprite(ctx, img, anchor, dw, dh, -dh);
  } else if (pose === 'duck') {
    const cut = split || 0.42;
    const headH = h * 0.4;
    const bodyH = h * 0.26;
    const srcH = img.naturalHeight;
    ctx.drawImage(
      img,
      0,
      srcH * cut,
      img.naturalWidth,
      srcH * (1 - cut),
      -dw * anchor,
      -bodyH,
      dw,
      bodyH,
    );
    ctx.drawImage(
      img,
      0,
      0,
      img.naturalWidth,
      srcH * cut,
      -dw * anchor,
      -(headH * 0.86 + bodyH),
      dw,
      headH,
    );
  } else {
    const step = Math.sin(time * 11);
    ctx.rotate(0.05);
    ctx.translate(0, -Math.max(0, step) * h * 0.02);
    paintSprite(ctx, img, anchor, dw, dh, -dh);
  }
  ctx.restore();
}

export function drawTraveller(ctx, x, footY, h, pose, time, alpha, fx, who) {
  const spec = characterById(who);
  ensureSprites(spec.id);
  const idlePose = pose === 'idle';
  const pair = spriteCache[spec.id];
  const img = pair ? (idlePose ? pair.idle : pair.run) : null;
  const sx = fx && fx.sx ? fx.sx : 1;
  const sy = fx && fx.sy ? fx.sy : 1;
  const drawH = h * spec.height;
  ctx.save();
  ctx.translate(x, footY);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(74, 36, 24, 0.18)';
  ctx.beginPath();
  ctx.ellipse(0, 4, drawH * 0.22 * (2 - sy), drawH * 0.045, 0, 0, Math.PI * 2);
  ctx.fill();
  if (spriteReady(img)) {
    ctx.save();
    ctx.scale(sx, sy);
    const anchor = idlePose ? spec.anchorIdle : spec.anchorRun;
    drawLoaded(ctx, img, anchor, drawH, pose, time, spec.duckSplit);
    ctx.restore();
  }
  ctx.restore();
}

export function drawCheckpoint(ctx, x, groundY, h) {
  ctx.save();
  ctx.translate(x, groundY);
  softShadow(ctx, 0, 3, h * 0.16, h * 0.045);
  ctx.fillStyle = '#4A2418';
  ctx.fillRect(-3, -h * 1.15, 6, h * 1.15);
  ctx.fillStyle = '#D0182F';
  ctx.beginPath();
  ctx.moveTo(3, -h * 1.15);
  ctx.lineTo(h * 0.42, -h * 0.96);
  ctx.lineTo(3, -h * 0.76);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillRect(8, -h * 1.02, h * 0.16, 3);
  ctx.restore();
}

export function drawMapScene(ctx, w, h, time, markers, who) {
  drawMapBackdrop(ctx, w, h, time);
  if (markers) {
    for (const marker of markers) {
      drawMapPin(
        ctx,
        marker.x * w,
        marker.y * h,
        (time || 0) + (marker.phase || 0),
        marker.label,
        marker.state,
      );
    }
  }
  const figure = Math.min(96, Math.max(72, h * 0.11));
  drawTraveller(ctx, w * 0.07, h * 0.3, figure, 'run', time, 1, null, who);
}
