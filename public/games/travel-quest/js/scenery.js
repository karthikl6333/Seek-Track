/**
 * Layered scenery: haze, skyline tiles, hero landmarks, weather, and the map.
 * Static bands are painted once into an offscreen canvas and then scrolled.
 */
import { createLayerCache, pixelRatio } from './layers.js';

const INK = '#2a2118';
const LIVE = new Set(['boats', 'lanterns', 'junks', 'longtails', 'abras', 'fountain', 'camels']);

let art = null;
function stamps() {
  if (!art && typeof document !== 'undefined') art = createLayerCache();
  return art;
}

export function clearArtCache() {
  if (art) art.clear();
}

function takeStamp(key, w, h, paint) {
  const box = stamps();
  if (!box) return null;
  return box.get(key, w, h, paint, pixelRatio());
}

function blitStrip(ctx, key, tileW, tileH, paint, scroll, destY, viewW) {
  const rec = takeStamp(key, tileW, tileH, paint);
  if (!rec) {
    paint(ctx, tileW, tileH);
    return;
  }
  const shift = ((scroll % tileW) + tileW) % tileW;
  let x = -shift;
  const guard = Math.ceil(viewW / tileW) + 2;
  for (let i = 0; i < guard && x < viewW; i += 1) {
    ctx.drawImage(rec.canvas, x, destY, tileW, tileH);
    x += tileW;
  }
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function ink(ctx, w) {
  ctx.strokeStyle = INK;
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

export function softShadow(ctx, x, y, rx, ry) {
  ctx.save();
  ctx.fillStyle = 'rgba(42, 33, 24, 0.2)';
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(2, rx), Math.max(2, ry), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function glow(ctx, x, y, r, inner) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, inner);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function rgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

export function mixHex(a, b, t) {
  if (!b || t <= 0) return a;
  if (t >= 1) return b;
  const pa = rgb(a);
  const pb = rgb(b);
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

const skyCache = { key: '', grad: null };

export function fillSky(ctx, w, h, top, bottom) {
  fillSkyRich(ctx, w, h, top, bottom, bottom);
}

export function horizonFor(night, bottom) {
  return mixHex(bottom, night ? '#ffb07a' : '#fff6dc', night ? 0.5 : 0.38);
}

export function fillSkyRich(ctx, w, h, top, bottom, horizon) {
  const key = `${top}|${bottom}|${horizon}|${w}|${h}`;
  if (key !== skyCache.key) {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, top);
    grad.addColorStop(0.58, bottom);
    grad.addColorStop(1, horizon || bottom);
    skyCache.key = key;
    skyCache.grad = grad;
  }
  ctx.fillStyle = skyCache.grad;
  ctx.fillRect(0, 0, w, h);
}

function puff(ctx, x, y, r, shade) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.arc(x + r * 0.85, y + r * 0.12, r * 0.72, 0, Math.PI * 2);
  ctx.arc(x - r * 0.8, y + r * 0.18, r * 0.64, 0, Math.PI * 2);
  ctx.fill();
  if (shade) {
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.35, r * 0.9, r * 0.28, 0, 0, Math.PI);
    ctx.fill();
  }
}

export function drawClouds(ctx, w, h, time, night) {
  ctx.save();
  for (let i = 0; i < 6; i += 1) {
    const speed = 10 + i * 5;
    const span = w + 220;
    const x = ((i * 210 - time * speed) % span + span) % span - 90;
    const y = h * (0.06 + (i % 3) * 0.055);
    const r = 18 + (i % 3) * 10;
    ctx.fillStyle = night ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.92)';
    puff(ctx, x, y, r, night ? null : 'rgba(176, 198, 214, 0.28)');
  }
  ctx.restore();
}

export function drawSun(ctx, w, h, time, low) {
  const x = w * (low ? 0.8 : 0.86);
  const y = h * (low ? 0.22 : 0.13);
  const spin = (time || 0) * 0.15;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spin);
  ctx.strokeStyle = low ? 'rgba(255, 170, 70, 0.45)' : 'rgba(255, 214, 120, 0.4)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 12; i += 1) {
    ctx.rotate(Math.PI / 6);
    ctx.beginPath();
    ctx.moveTo(34, 0);
    ctx.lineTo(52, 0);
    ctx.stroke();
  }
  ctx.rotate(-spin);
  glow(ctx, 0, 0, 70, low ? 'rgba(255, 176, 80, 0.45)' : 'rgba(255, 224, 138, 0.4)');
  ctx.fillStyle = low ? '#ffb347' : '#ffe08a';
  ctx.beginPath();
  ctx.arc(0, 0, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.beginPath();
  ctx.arc(-6, -6, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawMoon(ctx, w, h, skyTop) {
  const x = w * 0.84;
  const y = h * 0.14;
  ctx.save();
  glow(ctx, x, y, 48, 'rgba(255, 244, 210, 0.35)');
  ctx.fillStyle = '#fff6d2';
  ctx.beginPath();
  ctx.arc(x, y, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(214, 206, 170, 0.45)';
  ctx.beginPath();
  ctx.arc(x - 6, y - 4, 4, 0, Math.PI * 2);
  ctx.arc(x + 5, y + 4, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = skyTop;
  ctx.beginPath();
  ctx.arc(x + 10, y - 3, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawStars(ctx, w, h, time) {
  ctx.save();
  ctx.fillStyle = '#fff6d0';
  for (let i = 0; i < 28; i += 1) {
    const x = (i * 97 + 20) % Math.max(1, w);
    const y = (i * 53 + 12) % Math.max(1, h * 0.48);
    ctx.globalAlpha = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(time * 2 + i));
    const s = i % 7 === 0 ? 2.4 : 1.6;
    ctx.fillRect(x, y, s, s);
  }
  ctx.restore();
}

export function drawBirds(ctx, w, h, time) {
  ctx.save();
  ctx.strokeStyle = 'rgba(40, 48, 60, 0.62)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i += 1) {
    const span = w + 80;
    const x = ((time * (22 + i * 7) + i * 160) % span + span) % span - 20;
    const y = h * (0.1 + (i % 3) * 0.045) + Math.sin(time * 0.8 + i) * 6;
    const wing = Math.sin(time * 8 + i) * 5;
    ctx.beginPath();
    ctx.moveTo(x - 8, y + wing);
    ctx.quadraticCurveTo(x - 3, y - 5, x, y);
    ctx.quadraticCurveTo(x + 3, y - 5, x + 8, y + wing);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawHaze(ctx, w, groundY, color, time, speed, ph) {
  const tileW = 520;
  const tileH = Math.max(40, ph * 1.15);
  blitStrip(ctx, `haze|${color}|${Math.round(tileH)}`, tileW, tileH, (g, tw, th) => {
    g.fillStyle = color;
    g.globalAlpha = 0.45;
    for (let i = 0; i < 3; i += 1) {
      g.beginPath();
      g.ellipse(90 + i * 180, th + 6, 130, 52, 0, Math.PI, 0);
      g.fill();
    }
  }, time * speed * 0.08, groundY - tileH + 8, w);
}

export function drawFarStrip(ctx, w, groundY, motif, time, speed, ph, lift) {
  const base = groundY - (lift || 0);
  if (LIVE.has(motif)) {
    const spacing = ph * 2.6;
    const scroll = time * speed * 0.22;
    const start = -((scroll % spacing) + spacing);
    for (let x = start; x < w + spacing; x += spacing) {
      const variant = ((Math.floor((x + scroll) / spacing) % 2) + 2) % 2 ? 0.2 : 0.8;
      drawMotif(ctx, motif, x, base, ph * 1.55, variant, time);
    }
    return;
  }
  const tileW = 640;
  const tileH = Math.max(80, ph * 2.05);
  blitStrip(
    ctx,
    `far|${motif}|${Math.round(tileH)}`,
    tileW,
    tileH,
    (g, tw, th) => {
      drawMotif(g, motif, tw * 0.28, th - 2, ph * 1.65, 0.25, 0);
      drawMotif(g, motif, tw * 0.74, th - 2, ph * 1.85, 0.8, 0);
    },
    time * speed * 0.2,
    base - tileH + 4,
    w,
  );
}

export function drawWater(ctx, w, groundY, time, depth) {
  const band = depth || 86;
  const top = groundY - band;
  ctx.save();
  const grad = ctx.createLinearGradient(0, top, 0, groundY);
  grad.addColorStop(0, 'rgba(186, 236, 232, 0.15)');
  grad.addColorStop(0.35, 'rgba(46, 168, 176, 0.45)');
  grad.addColorStop(1, 'rgba(14, 92, 112, 0.72)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, top, w, band);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i += 1) {
    const y = top + 16 + i * (band / 5);
    const shift = time * (26 + i * 14);
    ctx.globalAlpha = 0.45 + (i % 2) * 0.35;
    ctx.beginPath();
    for (let x = -20; x <= w + 20; x += 16) {
      const yy = y + Math.sin((x + shift) * 0.045 + i) * 3.2;
      if (x === -20) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  ctx.restore();
}

export function drawGround(ctx, w, h, groundY, ground, groundTop, time, speed, kind, rush) {
  const depth = Math.max(0, h - groundY);
  const grad = ctx.createLinearGradient(0, groundY, 0, groundY + depth);
  grad.addColorStop(0, groundTop);
  grad.addColorStop(0.18, ground);
  grad.addColorStop(1, mixHex(ground, '#1c2430', 0.18));
  ctx.fillStyle = grad;
  ctx.fillRect(0, groundY, w, depth);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(0, groundY, w, 5);
  ctx.fillStyle = 'rgba(42, 33, 24, 0.18)';
  ctx.fillRect(0, groundY + 5, w, 3);
  const boost = rush || 0;
  const period = 64;
  const offset = (time * speed) % period;
  const y = groundY + Math.min(36, depth * 0.28);
  const len = 18 + boost * 36;
  ctx.fillStyle = kind === 'sand' ? 'rgba(255,248,230,0.45)' : 'rgba(255,255,255,0.42)';
  for (let x = -period; x < w + period; x += period) {
    roundRect(ctx, x - offset, y, len, kind === 'paddy' ? 3 : 5, 2);
    ctx.fill();
  }
  if (kind === 'sand') {
    ctx.fillStyle = 'rgba(180, 140, 70, 0.35)';
    for (let i = 0; i < 18; i += 1) {
      const sx = ((i * 73 - time * speed * 0.3) % (w + 20) + w + 20) % (w + 20);
      ctx.fillRect(sx, groundY + 18 + (i % 5) * 12, 3, 2);
    }
  } else if (kind === 'paddy') {
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 2;
    for (let row = 0; row < 3; row += 1) {
      const yy = groundY + 22 + row * 16;
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(w, yy + 4);
      ctx.stroke();
    }
  } else if (kind === 'plank') {
    ctx.strokeStyle = 'rgba(90, 52, 28, 0.25)';
    ctx.lineWidth = 2;
    const gap = 28;
    const slide = (time * speed) % gap;
    for (let x = -gap; x < w + gap; x += gap) {
      ctx.beginPath();
      ctx.moveTo(x - slide, groundY + 8);
      ctx.lineTo(x - slide, groundY + depth);
      ctx.stroke();
    }
  }
}

function prang(ctx, x, base, h, color) {
  ctx.save();
  ctx.translate(x, base);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -h);
  ctx.lineTo(h * 0.16, -h * 0.72);
  ctx.lineTo(h * 0.24, -h * 0.38);
  ctx.lineTo(h * 0.3, 0);
  ctx.lineTo(-h * 0.3, 0);
  ctx.lineTo(-h * 0.24, -h * 0.38);
  ctx.lineTo(-h * 0.16, -h * 0.72);
  ctx.closePath();
  fillInk(ctx, color, 1.6);
  ctx.strokeStyle = '#d9893a';
  ctx.lineWidth = 1.5;
  for (let i = 1; i <= 5; i += 1) {
    const yy = -h * (0.18 + i * 0.12);
    const half = h * (0.26 - i * 0.03);
    ctx.beginPath();
    ctx.moveTo(-half, yy);
    ctx.lineTo(half, yy);
    ctx.stroke();
  }
  const dots = ['#3a8fd6', '#2f9e5a', '#f2c14e', '#e25b45'];
  for (let i = 0; i < 6; i += 1) {
    ctx.fillStyle = dots[i % 4];
    ctx.fillRect(-h * 0.05, -h * 0.3 - i * h * 0.08, Math.max(2, h * 0.05), Math.max(2, h * 0.045));
  }
  ctx.fillStyle = '#f2c14e';
  ctx.beginPath();
  ctx.arc(0, -h, Math.max(2, h * 0.04), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTemples(ctx, x, y, size, variant) {
  ctx.save();
  ctx.translate(x, y);
  const s = size / 120;
  ctx.scale(s, s);
  ctx.fillStyle = '#efe6d2';
  roundRect(ctx, -48, -14, 96, 16, 3);
  fillInk(ctx, '#efe6d2', 1.5);
  prang(ctx, 0, -14, variant > 0.5 ? 92 : 78, '#f6ead0');
  prang(ctx, -30, -14, 40, '#f0d7a4');
  prang(ctx, 32, -14, 36, '#e7c98a');
  ctx.restore();
}

function drawTuktuks(ctx, x, y, size, variant) {
  const colors = ['#f2c14e', '#e25b45', '#3aa6a0', '#5b7fd6'];
  const body = colors[Math.floor((variant || 0) * 3.2) % 4];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 90, size / 90);
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.arc(-22, -8, 8, 0, Math.PI * 2);
  ctx.arc(18, -8, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d5dae2';
  ctx.beginPath();
  ctx.arc(-22, -8, 3, 0, Math.PI * 2);
  ctx.arc(18, -8, 3, 0, Math.PI * 2);
  ctx.fill();
  roundRect(ctx, -34, -36, 62, 26, 6);
  fillInk(ctx, body, 1.6);
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillRect(-30, -34, 54, 6);
  ctx.fillStyle = '#e9fbff';
  roundRect(ctx, -4, -32, 24, 12, 2);
  ctx.fill();
  roundRect(ctx, -6, -48, 36, 12, 4);
  fillInk(ctx, body, 1.4);
  ctx.fillStyle = '#f3c19a';
  ctx.beginPath();
  ctx.arc(-16, -30, 5, 0, Math.PI * 2);
  ctx.fill();
  thaiFlag(ctx, 24, -52, 14);
  ctx.restore();
}

function thaiFlag(ctx, x, y, h) {
  const stripes = ['#d0182f', '#fff', '#2a3f8f', '#fff', '#d0182f'];
  ctx.save();
  ctx.translate(x, y);
  for (let i = 0; i < 5; i += 1) {
    ctx.fillStyle = stripes[i];
    ctx.fillRect(0, i * (h / 5), h * 1.5, h / 5 + 0.4);
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, h * 1.5, h);
  ctx.restore();
}

function vnFlag(ctx, x, y, w) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#d0182f';
  ctx.fillRect(0, 0, w, w * 0.66);
  ctx.fillStyle = '#f2c14e';
  starPath(ctx, w * 0.5, w * 0.34, w * 0.18);
  ctx.fill();
  ctx.restore();
}

function starPath(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? r : r * 0.42;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = x + Math.cos(a) * radius;
    const py = y + Math.sin(a) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawBoats(ctx, x, y, size, variant, time) {
  ctx.save();
  ctx.translate(x, y + Math.sin((time || 0) * 1.6 + (variant || 0) * 6) * 3);
  ctx.scale(size / 86, size / 86);
  ctx.fillStyle = '#8d4b2b';
  ctx.beginPath();
  ctx.moveTo(-40, -14);
  ctx.quadraticCurveTo(-36, 8, -24, 8);
  ctx.lineTo(22, 8);
  ctx.quadraticCurveTo(34, 8, 32, -14);
  ctx.closePath();
  fillInk(ctx, '#a8643a', 1.6);
  ctx.fillStyle = '#6b3a22';
  ctx.fillRect(-28, -4, 48, 4);
  ctx.fillStyle = variant > 0.5 ? '#f25c54' : '#f2c14e';
  ctx.beginPath();
  ctx.moveTo(-8, -14);
  ctx.lineTo(16, -14);
  ctx.quadraticCurveTo(18, -36, 0, -38);
  ctx.quadraticCurveTo(-14, -36, -8, -14);
  ctx.fill();
  ink(ctx, 1.4);
  ctx.fillStyle = '#f5b423';
  ctx.beginPath();
  ctx.ellipse(-16, -16, 7, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e25b45';
  ctx.beginPath();
  ctx.arc(8, -18, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2f9e5a';
  ctx.fillRect(-6, -20, 8, 4);
  ctx.fillStyle = '#f3c19a';
  ctx.beginPath();
  ctx.arc(-2, -28, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawAwnings(ctx, x, y, size, variant) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 96, size / 96);
  ctx.strokeStyle = '#5c331c';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-36, 0);
  ctx.lineTo(-36, -48);
  ctx.moveTo(36, 0);
  ctx.lineTo(36, -48);
  ctx.stroke();
  for (let i = 0; i < 7; i += 1) {
    ctx.fillStyle = (i + (variant > 0.5 ? 1 : 0)) % 2 === 0 ? '#e25b45' : '#f2c14e';
    ctx.beginPath();
    ctx.moveTo(-36 + i * 11, -48);
    ctx.lineTo(-25 + i * 11, -48);
    ctx.lineTo(-28 + i * 11, -22);
    ctx.lineTo(-39 + i * 11, -22);
    ctx.closePath();
    ctx.fill();
    ink(ctx, 1);
  }
  ctx.restore();
}

function drawPalms(ctx, x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 130, size / 130);
  ctx.strokeStyle = '#8a5a32';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(18, -46, -2, -86);
  ctx.stroke();
  ctx.strokeStyle = '#1f7a40';
  ctx.lineWidth = 5;
  for (let i = 0; i < 7; i += 1) {
    const a = -2.6 + i * 0.45;
    ctx.beginPath();
    ctx.moveTo(-2, -84);
    ctx.quadraticCurveTo(Math.cos(a) * 20, -86 + Math.sin(a) * 10, Math.cos(a) * 46, -74 + Math.sin(a) * 24);
    ctx.stroke();
  }
  ctx.fillStyle = '#f2c14e';
  ctx.beginPath();
  ctx.ellipse(-2, -78, 5, 7, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawUmbrellas(ctx, x, y, size, variant) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 86, size / 86);
  ctx.strokeStyle = '#c9843a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -34);
  ctx.stroke();
  ctx.fillStyle = variant > 0.5 ? '#ef5b6a' : '#3aa6d8';
  ctx.beginPath();
  ctx.arc(0, -34, 30, Math.PI, 0);
  ctx.closePath();
  fillInk(ctx, variant > 0.5 ? '#ef5b6a' : '#3aa6d8', 1.5);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  ctx.moveTo(0, -34);
  ctx.lineTo(0, -62);
  ctx.moveTo(-16, -48);
  ctx.lineTo(0, -34);
  ctx.lineTo(16, -48);
  ctx.stroke();
  ctx.fillStyle = '#f6e2b5';
  ctx.beginPath();
  ctx.ellipse(0, -2, 20, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawLanternShape(ctx, x, y, s, color) {
  ctx.save();
  ctx.translate(x, y);
  glow(ctx, 0, 0, s * 1.15, 'rgba(255, 196, 90, 0.55)');
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.55);
  ctx.bezierCurveTo(s * 0.55, -s * 0.15, s * 0.48, s * 0.35, 0, s * 0.48);
  ctx.bezierCurveTo(-s * 0.48, s * 0.35, -s * 0.55, -s * 0.15, 0, -s * 0.55);
  ctx.closePath();
  fillInk(ctx, color, Math.max(1.2, s * 0.06));
  ctx.strokeStyle = 'rgba(255,244,200,0.8)';
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.28);
  ctx.lineTo(0, s * 0.28);
  ctx.moveTo(-s * 0.16, -s * 0.05);
  ctx.lineTo(s * 0.16, -s * 0.05);
  ctx.stroke();
  ctx.strokeStyle = '#6b3a12';
  ctx.lineWidth = Math.max(1, s * 0.07);
  ctx.beginPath();
  ctx.moveTo(0, s * 0.48);
  ctx.lineTo(0, s * 0.78);
  ctx.stroke();
  ctx.fillStyle = '#f2c14e';
  ctx.fillRect(-s * 0.18, -s * 0.64, s * 0.36, s * 0.1);
  ctx.fillStyle = '#c9843a';
  ctx.beginPath();
  ctx.moveTo(-s * 0.08, s * 0.78);
  ctx.lineTo(s * 0.08, s * 0.78);
  ctx.lineTo(0, s * 0.96);
  ctx.fill();
  ctx.restore();
}

function drawLanternMotif(ctx, x, y, size, variant, time) {
  ctx.save();
  ctx.translate(x, y - size * 0.72);
  ctx.scale(size / 100, size / 100);
  const sway = Math.sin((time || 0) * 1.8 + (variant || 0) * 4);
  ctx.strokeStyle = '#6b3a22';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-50, 0);
  ctx.quadraticCurveTo(0, 10 + sway * 2, 50, 2);
  ctx.stroke();
  const colors = ['#e23d3d', '#f2c14e', '#3aa6a0', '#e25b45'];
  for (let i = 0; i < 4; i += 1) {
    const ly = 14 + Math.sin((time || 0) * 2 + i + (variant || 0) * 5) * 3;
    drawLanternShape(ctx, -36 + i * 24, ly, 16, colors[i]);
  }
  ctx.restore();
}

function drawShophouses(ctx, x, y, size, variant) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 110, size / 110);
  const wall = variant > 0.5 ? '#f2c14e' : '#e7a15a';
  roundRect(ctx, -38, -78, 76, 78, 2);
  fillInk(ctx, wall, 1.6);
  ctx.fillStyle = '#6e2e32';
  ctx.fillRect(-44, -86, 88, 12);
  ctx.fillStyle = '#4a2418';
  ctx.fillRect(-46, -90, 92, 6);
  for (let r = 0; r < 2; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#ffe7a8' : '#6e4a32';
      roundRect(ctx, -26 + c * 18, -64 + r * 26, 12, 16, 1);
      ctx.fill();
      if ((r + c) % 2 === 0) {
        glow(ctx, -20 + c * 18, -56 + r * 26, 10, 'rgba(255, 210, 120, 0.45)');
      }
    }
  }
  ctx.fillStyle = '#5c331c';
  roundRect(ctx, -10, -22, 20, 22, 2);
  ctx.fill();
  ctx.restore();
}

function drawKarsts(ctx, x, y, size, variant) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 140, size / 140);
  const peak = 90 + (variant || 0) * 40;
  ctx.fillStyle = variant > 0.55 ? '#8eaa9c' : '#5f857c';
  ctx.beginPath();
  ctx.moveTo(-48, 0);
  ctx.lineTo(-18, -peak);
  ctx.lineTo(-4, -peak * 0.62);
  ctx.lineTo(10, -peak * 1.15);
  ctx.lineTo(28, -peak * 0.4);
  ctx.lineTo(54, 0);
  ctx.closePath();
  fillInk(ctx, variant > 0.55 ? '#8eaa9c' : '#5f857c', 1.5);
  ctx.fillStyle = '#dfeee6';
  ctx.beginPath();
  ctx.moveTo(-6, -peak * 0.72);
  ctx.lineTo(8, -peak * 0.45);
  ctx.lineTo(-2, -peak * 0.38);
  ctx.fill();
  ctx.fillStyle = '#2f6b45';
  ctx.beginPath();
  ctx.ellipse(-16, -peak + 8, 14, 6, 0, 0, Math.PI * 2);
  ctx.ellipse(8, -peak * 1.1, 12, 5, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCliffs(ctx, x, y, size, variant) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 150, size / 150);
  const tall = variant > 0.5;
  ctx.fillStyle = '#e7e0d2';
  ctx.beginPath();
  ctx.moveTo(-56, 0);
  ctx.lineTo(-40, -70);
  ctx.lineTo(-18, -118);
  ctx.lineTo(4, -78);
  ctx.lineTo(16, tall ? -140 : -124);
  ctx.lineTo(36, -64);
  ctx.lineTo(58, 0);
  ctx.closePath();
  fillInk(ctx, '#efe8da', 1.6);
  ctx.fillStyle = '#c5d5c8';
  ctx.beginPath();
  ctx.moveTo(-8, -90);
  ctx.lineTo(6, -60);
  ctx.lineTo(-10, -54);
  ctx.fill();
  if (!tall) {
    ctx.fillStyle = '#d5ebe8';
    ctx.beginPath();
    ctx.ellipse(6, -28, 10, 14, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#2f7a48';
  ctx.beginPath();
  ctx.ellipse(-16, -112, 16, 7, -0.3, 0, Math.PI * 2);
  ctx.ellipse(18, tall ? -136 : -120, 14, 6, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(20, 90, 100, 0.35)';
  ctx.fillRect(-56, -8, 114, 10);
  ctx.restore();
}

function drawLongtails(ctx, x, y, size, variant, time) {
  ctx.save();
  ctx.translate(x, y + Math.sin((time || 0) * 1.7 + (variant || 0) * 5) * 2.5);
  ctx.scale(size / 100, size / 100);
  ctx.fillStyle = variant > 0.5 ? '#c45a3a' : '#2f6f9a';
  ctx.beginPath();
  ctx.moveTo(-46, -8);
  ctx.lineTo(18, -8);
  ctx.lineTo(10, 8);
  ctx.lineTo(-40, 8);
  ctx.closePath();
  fillInk(ctx, variant > 0.5 ? '#d06a48' : '#3a82b0', 1.5);
  ctx.fillStyle = '#f4e2b0';
  ctx.beginPath();
  ctx.moveTo(-16, -8);
  ctx.lineTo(8, -8);
  ctx.quadraticCurveTo(10, -28, -6, -26);
  ctx.quadraticCurveTo(-22, -24, -16, -8);
  ctx.fill();
  ink(ctx, 1.2);
  ctx.strokeStyle = '#5c331c';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(12, -2);
  ctx.lineTo(48, 14);
  ctx.stroke();
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.arc(48, 16, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#e25b45';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(20, 6);
  ctx.quadraticCurveTo(30, 2 + Math.sin((time || 0) * 6) * 2, 40, 10);
  ctx.stroke();
  ctx.restore();
}

function drawJunks(ctx, x, y, size, variant, time) {
  ctx.save();
  ctx.translate(x, y + Math.sin((time || 0) * 1.3 + (variant || 0) * 4) * 2.4);
  ctx.scale(size / 110, size / 110);
  ctx.fillStyle = '#7a3e24';
  ctx.beginPath();
  ctx.moveTo(-36, -6);
  ctx.lineTo(30, -6);
  ctx.lineTo(18, 10);
  ctx.lineTo(-26, 10);
  ctx.closePath();
  fillInk(ctx, '#8d4b2b', 1.5);
  ctx.fillStyle = '#5a3318';
  ctx.fillRect(-2, -70, 4, 64);
  ctx.fillStyle = variant > 0.5 ? '#e25b45' : '#f4e2b0';
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.quadraticCurveTo(-28, -20, -30, -36);
  ctx.lineTo(2, -62);
  ctx.quadraticCurveTo(8, -30, 0, -8);
  ctx.fill();
  ink(ctx, 1.3);
  ctx.strokeStyle = '#6b3a22';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath();
    ctx.moveTo(-2, -18 - i * 14);
    ctx.lineTo(-22 + i * 2, -24 - i * 8);
    ctx.stroke();
  }
  vnFlag(ctx, 6, -78, 16);
  ctx.restore();
}

function drawTerraces(ctx, x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 120, size / 120);
  const bands = ['#d6de62', '#9ad86a', '#6fb34a', '#3f8f38', '#2f6b32'];
  for (let i = 0; i < 5; i += 1) {
    const yy = -4 - i * 16;
    const half = 58 - i * 8;
    ctx.fillStyle = bands[i];
    ctx.beginPath();
    ctx.moveTo(-half, yy);
    ctx.quadraticCurveTo(0, yy - 6, half, yy);
    ctx.lineTo(half - 10, yy + 12);
    ctx.quadraticCurveTo(0, yy + 6, -half + 10, yy + 12);
    ctx.closePath();
    fillInk(ctx, bands[i], 1.2);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.moveTo(-half + 12, yy + 4);
    ctx.quadraticCurveTo(0, yy - 1, half - 14, yy + 3);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStalls(ctx, x, y, size, variant) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 100, size / 100);
  ctx.fillStyle = '#8d4b2b';
  ctx.fillRect(-28, -18, 56, 8);
  ctx.fillRect(-24, -10, 6, 12);
  ctx.fillRect(18, -10, 6, 12);
  const cloth = variant > 0.5 ? '#e25b45' : '#3aa6a0';
  ctx.fillStyle = cloth;
  ctx.beginPath();
  ctx.moveTo(-32, -40);
  ctx.lineTo(32, -40);
  ctx.lineTo(26, -18);
  ctx.lineTo(-26, -18);
  ctx.closePath();
  fillInk(ctx, cloth, 1.4);
  ctx.fillStyle = '#f5b423';
  ctx.beginPath();
  ctx.arc(-8, -22, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2f9e5a';
  ctx.fillRect(4, -26, 12, 5);
  ctx.fillStyle = '#f3c19a';
  ctx.beginPath();
  ctx.arc(0, -32, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawRuins(ctx, x, y, size, variant) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 120, size / 120);
  ctx.fillStyle = '#e7d7b4';
  ctx.fillRect(-40, -12, 80, 12);
  prang(ctx, variant > 0.5 ? -8 : 0, -12, variant > 0.5 ? 58 : 74, '#ead9b4');
  ctx.fillStyle = '#cbb892';
  ctx.beginPath();
  ctx.moveTo(16, -12);
  ctx.lineTo(28, -46);
  ctx.lineTo(36, -18);
  ctx.lineTo(42, -12);
  ctx.fill();
  ink(ctx, 1.3);
  ctx.restore();
}

function drawRedbridge(ctx, x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 130, size / 130);
  ctx.strokeStyle = '#d0182f';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(-58, 0);
  ctx.quadraticCurveTo(0, -48, 58, 0);
  ctx.stroke();
  ctx.fillStyle = '#e25b45';
  ctx.fillRect(-50, -16, 100, 8);
  ctx.fillStyle = '#f2c14e';
  for (let i = 0; i < 6; i += 1) ctx.fillRect(-44 + i * 16, -28, 4, 14);
  roofTier(ctx, 36, -8, 16, 14, '#c4553a');
  ctx.restore();
}

function drawJpbridge(ctx, x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 130, size / 130);
  ctx.fillStyle = '#8d4b2b';
  ctx.beginPath();
  ctx.moveTo(-56, 0);
  ctx.quadraticCurveTo(0, -36, 56, 0);
  ctx.lineTo(48, -8);
  ctx.quadraticCurveTo(0, -28, -48, -8);
  ctx.fill();
  ctx.fillStyle = '#f2c14e';
  ctx.fillRect(-40, -34, 80, 16);
  roofTier(ctx, 0, -34, 48, 16, '#c4553a');
  ctx.fillStyle = '#6b3a22';
  ctx.fillRect(-46, -18, 10, 18);
  ctx.fillRect(36, -18, 10, 18);
  ctx.restore();
}

function drawMetro(ctx, x, y, size, variant) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 120, size / 120);
  ctx.strokeStyle = '#8aa0aa';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-60, -28);
  ctx.lineTo(60, -28);
  ctx.stroke();
  ctx.fillStyle = '#dfe6ea';
  ctx.fillRect(-50, -8, 6, 8);
  ctx.fillRect(44, -8, 6, 8);
  const body = variant > 0.5 ? '#e25b45' : '#d4a017';
  roundRect(ctx, -36, -40, 72, 18, 5);
  fillInk(ctx, body, 1.4);
  ctx.fillStyle = '#d7f3ff';
  for (let i = 0; i < 3; i += 1) ctx.fillRect(-26 + i * 20, -36, 12, 8);
  ctx.restore();
}

function drawTowers(ctx, x, y, size, variant) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 140, size / 140);
  ctx.fillStyle = variant > 0.5 ? '#c5d5e0' : '#9fb4c4';
  ctx.fillRect(-28, -70, 22, 70);
  ctx.fillRect(8, -96, 16, 96);
  ctx.fillStyle = '#8fd4ff';
  for (let i = 0; i < 5; i += 1) ctx.fillRect(11, -88 + i * 16, 10, 6);
  ctx.fillStyle = '#e7eef2';
  ctx.beginPath();
  ctx.moveTo(16, -120);
  ctx.lineTo(22, -96);
  ctx.lineTo(10, -96);
  ctx.fill();
  ink(ctx, 1.3);
  ctx.restore();
}

function drawFountain(ctx, x, y, size, variant, time) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 110, size / 110);
  ctx.fillStyle = '#d8c4a4';
  ctx.fillRect(-34, -8, 68, 8);
  ctx.strokeStyle = '#7ad4e8';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (let i = 0; i < 5; i += 1) {
    const px = -24 + i * 12;
    const rise = 18 + (i === 2 ? 16 : 0) + Math.sin((time || 0) * 3 + i) * 4;
    ctx.beginPath();
    ctx.moveTo(px, -8);
    ctx.quadraticCurveTo(px + 4, -rise, px, -8);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWindtowers(ctx, x, y, size, variant) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 120, size / 120);
  ctx.fillStyle = variant > 0.5 ? '#f3e2c4' : '#e7d3b0';
  roundRect(ctx, -18, -78, 36, 78, 2);
  fillInk(ctx, variant > 0.5 ? '#f3e2c4' : '#e7d3b0', 1.4);
  ctx.fillStyle = '#6b3a22';
  ctx.fillRect(-22, -86, 44, 10);
  ctx.fillRect(-8, -70, 16, 8);
  ctx.fillStyle = '#1c2430';
  ctx.fillRect(-10, -48, 8, 12);
  ctx.fillRect(2, -30, 8, 12);
  ctx.restore();
}

function drawSouks(ctx, x, y, size, variant) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 120, size / 120);
  ctx.fillStyle = '#c9843a';
  ctx.fillRect(-40, -36, 80, 36);
  ctx.fillStyle = variant > 0.5 ? '#e25b45' : '#3aa6a0';
  ctx.beginPath();
  ctx.moveTo(-44, -36);
  ctx.lineTo(44, -36);
  ctx.lineTo(36, -52);
  ctx.lineTo(-36, -52);
  ctx.fill();
  ctx.fillStyle = '#1c2430';
  ctx.beginPath();
  ctx.arc(0, -8, 14, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#f2c14e';
  ctx.fillRect(-28, -28, 10, 16);
  ctx.fillStyle = '#6b2e6b';
  ctx.fillRect(8, -30, 14, 18);
  ctx.restore();
}

function drawAbras(ctx, x, y, size, variant, time) {
  ctx.save();
  ctx.translate(x, y + Math.sin((time || 0) * 1.5 + (variant || 0) * 4) * 2);
  ctx.scale(size / 100, size / 100);
  ctx.fillStyle = '#a8643a';
  ctx.beginPath();
  ctx.moveTo(-40, -6);
  ctx.quadraticCurveTo(-36, 10, 0, 10);
  ctx.quadraticCurveTo(36, 10, 34, -6);
  ctx.closePath();
  fillInk(ctx, '#c4844a', 1.4);
  ctx.fillStyle = '#f4e2b0';
  ctx.fillRect(-10, -16, 28, 10);
  ctx.fillStyle = '#f3c19a';
  ctx.beginPath();
  ctx.arc(-4, -12, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawDunes(ctx, x, y, size, variant) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 140, size / 140);
  ctx.fillStyle = variant > 0.5 ? '#f6d39a' : '#e7b56a';
  ctx.beginPath();
  ctx.moveTo(-70, 0);
  ctx.quadraticCurveTo(-30, -48, 10, 0);
  ctx.quadraticCurveTo(40, -70, 80, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,248,230,0.45)';
  ctx.beginPath();
  ctx.moveTo(-50, -8);
  ctx.quadraticCurveTo(-20, -36, 8, -6);
  ctx.strokeStyle = 'rgba(255,248,230,0.5)';
  ctx.stroke();
  ctx.restore();
}

function drawSail(ctx, x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 150, size / 150);
  ctx.fillStyle = '#f7f4ee';
  ctx.beginPath();
  ctx.moveTo(-8, 0);
  ctx.quadraticCurveTo(-48, -70, 0, -120);
  ctx.quadraticCurveTo(36, -70, 12, 0);
  ctx.closePath();
  fillInk(ctx, '#f7f4ee', 1.5);
  ctx.fillStyle = '#1f6fbf';
  ctx.fillRect(-3, -100, 6, 78);
  ctx.fillStyle = '#e7eef2';
  ctx.fillRect(-22, -8, 48, 10);
  ctx.restore();
}

function drawCamels(ctx, x, y, size, variant, time) {
  const step = Math.sin((time || 0) * 5 + (variant || 0));
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 110, size / 110);
  ctx.fillStyle = '#c9843a';
  ctx.fillRect(-16, -16, 5, 16 + step);
  ctx.fillRect(10, -16, 5, 16 - step);
  ctx.beginPath();
  ctx.ellipse(0, -28, 24, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-4, -38, 10, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(16, -34, 8, 7, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ink(ctx, 1.3);
  ctx.restore();
}

function drawPalmisle(ctx, x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 140, size / 140);
  ctx.fillStyle = '#7dba5a';
  ctx.beginPath();
  ctx.ellipse(0, -8, 16, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#d8b56a';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  for (let i = -3; i <= 3; i += 1) {
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.quadraticCurveTo(i * 10, -28, i * 18, -6);
    ctx.stroke();
  }
  ctx.restore();
}

export const MOTIF_DRAW = {
  temples: drawTemples,
  tuktuks: drawTuktuks,
  boats: drawBoats,
  awnings: drawAwnings,
  palms: drawPalms,
  umbrellas: drawUmbrellas,
  lanterns: drawLanternMotif,
  shophouses: drawShophouses,
  karsts: drawKarsts,
  junks: drawJunks,
  terraces: drawTerraces,
  cliffs: drawCliffs,
  longtails: drawLongtails,
  stalls: drawStalls,
  ruins: drawRuins,
  redbridge: drawRedbridge,
  jpbridge: drawJpbridge,
  metro: drawMetro,
  towers: drawTowers,
  fountain: drawFountain,
  windtowers: drawWindtowers,
  souks: drawSouks,
  abras: drawAbras,
  dunes: drawDunes,
  sail: drawSail,
  camels: drawCamels,
  palmisle: drawPalmisle,
};

export function drawMotif(ctx, name, x, y, size, variant, time) {
  const draw = MOTIF_DRAW[name];
  if (draw) draw(ctx, x, y, size, variant, time);
}

function drawWat(ctx, h) {
  ctx.fillStyle = '#d7ece8';
  ctx.fillRect(-h * 0.55, -h * 0.08, h * 1.1, h * 0.1);
  ctx.fillStyle = '#efe6d2';
  roundRect(ctx, -h * 0.42, -h * 0.16, h * 0.84, h * 0.12, 3);
  ctx.fill();
  ink(ctx, 1.5);
  prang(ctx, 0, -h * 0.16, h * 0.78, '#f7efe2');
  prang(ctx, -h * 0.28, -h * 0.16, h * 0.4, '#f0d7a4');
  prang(ctx, h * 0.28, -h * 0.16, h * 0.36, '#e7c98a');
  prang(ctx, -h * 0.14, -h * 0.16, h * 0.5, '#f3e2bc');
  prang(ctx, h * 0.14, -h * 0.16, h * 0.48, '#f6e7c4');
}

function drawPalace(ctx, h) {
  ctx.fillStyle = '#f7f1e4';
  roundRect(ctx, -h * 0.62, -h * 0.28, h * 1.24, h * 0.28, 2);
  fillInk(ctx, '#f7f1e4', 1.5);
  ctx.fillStyle = '#c4553a';
  for (let i = 0; i < 5; i += 1) ctx.fillRect(-h * 0.5 + i * h * 0.22, -h * 0.22, h * 0.1, h * 0.14);
  roofTier(ctx, 0, -h * 0.28, h * 0.7, h * 0.16, '#e08a3c');
  roofTier(ctx, 0, -h * 0.4, h * 0.5, h * 0.12, '#f2c14e');
  roofTier(ctx, 0, -h * 0.5, h * 0.32, h * 0.1, '#d9893a');
  ctx.fillStyle = '#f2c14e';
  ctx.beginPath();
  ctx.moveTo(h * 0.34, -h * 0.2);
  ctx.lineTo(h * 0.42, -h * 0.62);
  ctx.lineTo(h * 0.5, -h * 0.2);
  ctx.fill();
  ink(ctx, 1.3);
  ctx.fillStyle = '#2f9e5a';
  ctx.beginPath();
  ctx.moveTo(-h * 0.46, -h * 0.2);
  ctx.lineTo(-h * 0.4, -h * 0.5);
  ctx.lineTo(-h * 0.34, -h * 0.2);
  ctx.fill();
  ink(ctx, 1.2);
}

function roofTier(ctx, x, y, w, rise, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - w, y);
  ctx.lineTo(x, y - rise);
  ctx.lineTo(x + w, y);
  ctx.closePath();
  fillInk(ctx, color, 1.3);
  ctx.fillStyle = '#fff6d2';
  ctx.beginPath();
  ctx.arc(x - w, y, 3.5, 0, Math.PI * 2);
  ctx.arc(x + w, y, 3.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawMarketHero(ctx, h, time) {
  drawBoats(ctx, -h * 0.28, 0, h * 0.7, 0.2, time);
  drawBoats(ctx, h * 0.28, 4, h * 0.85, 0.8, time);
  drawAwnings(ctx, 0, -h * 0.02, h * 0.55, 0.4);
}

function drawPhiPhi(ctx, h) {
  drawCliffs(ctx, -h * 0.22, 0, h * 1.15, 0.8);
  drawCliffs(ctx, h * 0.32, 0, h * 0.85, 0.2);
  drawPalms(ctx, -h * 0.55, 0, h * 0.45);
}

function drawHoiAn(ctx, h) {
  drawShophouses(ctx, -h * 0.42, 0, h * 0.7, 0.2);
  drawShophouses(ctx, 0, 0, h * 0.82, 0.8);
  drawShophouses(ctx, h * 0.42, 0, h * 0.64, 0.3);
  ctx.fillStyle = '#6b3a22';
  ctx.fillRect(-h * 0.2, -h * 0.22, h * 0.16, h * 0.22);
  ctx.beginPath();
  ctx.arc(-h * 0.12, -h * 0.22, h * 0.1, Math.PI, 0);
  ctx.fill();
  roofTier(ctx, -h * 0.12, -h * 0.3, h * 0.16, h * 0.08, '#8d4b2b');
}

function hoiAnLive(ctx, h, time) {
  const colors = ['#e23d3d', '#f2c14e', '#3aa6a0', '#e25b45', '#f4e2b0'];
  ctx.strokeStyle = '#4a2418';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-h * 0.55, -h * 0.62);
  ctx.quadraticCurveTo(0, -h * 0.5, h * 0.55, -h * 0.66);
  ctx.stroke();
  for (let i = 0; i < 5; i += 1) {
    const x = -h * 0.4 + i * h * 0.2;
    const sway = Math.sin(time * 1.7 + i) * h * 0.03;
    drawLanternShape(ctx, x + sway, -h * 0.48, h * 0.09, colors[i]);
  }
}

function drawHaLong(ctx, h) {
  drawKarsts(ctx, -h * 0.32, 0, h * 1.15, 0.8);
  drawKarsts(ctx, h * 0.22, 0, h * 0.9, 0.25);
  drawKarsts(ctx, h * 0.5, 0, h * 0.55, 0.6);
}

function drawTerraceHero(ctx, h) {
  drawTerraces(ctx, 0, 0, h * 1.3);
  drawTerraces(ctx, -h * 0.35, h * 0.02, h * 0.8);
}

function drawBurj(ctx, h) {
  ctx.fillStyle = '#d7e6ee';
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.92);
  ctx.lineTo(h * 0.05, -h * 0.72);
  ctx.lineTo(h * 0.09, -h * 0.42);
  ctx.lineTo(h * 0.14, -h * 0.16);
  ctx.lineTo(h * 0.2, 0);
  ctx.lineTo(-h * 0.2, 0);
  ctx.lineTo(-h * 0.14, -h * 0.16);
  ctx.lineTo(-h * 0.09, -h * 0.42);
  ctx.lineTo(-h * 0.05, -h * 0.72);
  ctx.closePath();
  fillInk(ctx, '#d7e6ee', 1.4);
  ctx.fillStyle = '#8fd4ff';
  for (let i = 0; i < 8; i += 1) ctx.fillRect(-h * 0.03, -h * 0.22 - i * h * 0.07, h * 0.06, h * 0.025);
  ctx.fillStyle = '#f4efe4';
  ctx.fillRect(-h * 0.28, -h * 0.08, h * 0.56, h * 0.08);
}

function drawFountainShow(ctx, h, time) {
  drawTowers(ctx, -h * 0.42, 0, h * 0.7, 0.2);
  drawBurj(ctx, h * 0.55);
  drawFountain(ctx, h * 0.15, 0, h * 0.7, 0.4, time);
}

function drawCreekScene(ctx, h, time) {
  drawWindtowers(ctx, -h * 0.28, 0, h * 0.85, 0.3);
  drawAbras(ctx, h * 0.22, 0, h * 0.7, 0.4, time);
  drawWindtowers(ctx, h * 0.48, 0, h * 0.55, 0.8);
}

function drawSoukScene(ctx, h) {
  drawSouks(ctx, -h * 0.25, 0, h * 0.9, 0.2);
  drawSouks(ctx, h * 0.28, 0, h * 0.75, 0.8);
  drawWindtowers(ctx, 0, 0, h * 0.6, 0.5);
}

function drawDuneLine(ctx, h, time) {
  drawDunes(ctx, 0, 0, h * 1.3, 0.7);
  drawCamels(ctx, -h * 0.15, 0, h * 0.45, 0.3, time);
}

function drawCoast(ctx, h) {
  drawSail(ctx, h * 0.2, 0, h * 0.85);
  drawPalmisle(ctx, -h * 0.35, 0, h * 0.7);
}

const LANDMARK_DRAW = {
  watArun: (ctx, h) => drawWat(ctx, h),
  grandPalace: (ctx, h) => drawPalace(ctx, h),
  marketBoats: (ctx, h, time) => drawMarketHero(ctx, h, time),
  ruins: (ctx, h) => drawRuins(ctx, 0, 0, h, 0.4),
  phiPhi: (ctx, h) => drawPhiPhi(ctx, h),
  longtailHero: (ctx, h, time) => drawLongtails(ctx, 0, 0, h * 0.95, 0.3, time),
  hoiAn: (ctx, h) => drawHoiAn(ctx, h),
  hucBridge: (ctx, h) => drawRedbridge(ctx, 0, 0, h),
  japaneseBridge: (ctx, h) => drawJpbridge(ctx, 0, 0, h),
  oldQuarter: (ctx, h) => drawHoiAn(ctx, h * 0.9),
  haLong: (ctx, h) => drawHaLong(ctx, h),
  junkHero: (ctx, h, time) => drawJunks(ctx, 0, 0, h, 0.7, time),
  burj: (ctx, h) => drawBurj(ctx, h),
  fountainShow: (ctx, h, time) => drawFountainShow(ctx, h, time),
  creek: (ctx, h, time) => drawCreekScene(ctx, h, time),
  souk: (ctx, h) => drawSoukScene(ctx, h),
  duneLine: (ctx, h, time) => drawDuneLine(ctx, h, time),
  burjAlArab: (ctx, h) => drawCoast(ctx, h),
};

const LANDMARK_LIVE = {
  watArun: (ctx, h, time) => {
    const wave = Math.sin(time * 3) * 0.15;
    ctx.save();
    ctx.translate(-h * 0.48, -h * 0.2);
    ctx.rotate(wave);
    thaiFlag(ctx, 0, 0, h * 0.08);
    ctx.restore();
  },
  grandPalace: (ctx, h, time) => {
    ctx.save();
    ctx.translate(h * 0.5, -h * 0.66);
    ctx.rotate(Math.sin(time * 2.4) * 0.2);
    thaiFlag(ctx, 0, 0, h * 0.07);
    ctx.restore();
  },
  hoiAn: hoiAnLive,
  ruins: hoiAnLive,
  oldQuarter: hoiAnLive,
  phiPhi: (ctx, h, time) => drawLongtails(ctx, h * 0.15, -h * 0.02, h * 0.42, 0.6, time),
  haLong: (ctx, h, time) => drawJunks(ctx, h * 0.05, 2, h * 0.4, 0.4, time),
  burj: (ctx, h, time) => {
    ctx.save();
    ctx.translate(h * 0.22, -h * 0.2);
    ctx.rotate(Math.sin(time * 2) * 0.1);
    ctx.fillStyle = '#d0182f';
    ctx.fillRect(0, 0, h * 0.08, h * 0.05);
    ctx.restore();
  },
};

const ASPECT = {
  watArun: 1.15,
  grandPalace: 1.45,
  marketBoats: 1.8,
  phiPhi: 1.7,
  longtailHero: 1.5,
  hoiAn: 1.85,
  haLong: 1.7,
  junkHero: 1.25,
  terraceHero: 1.65,
  ruins: 1.4,
  hucBridge: 1.6,
  japaneseBridge: 1.55,
  oldQuarter: 1.8,
  burj: 0.85,
  fountainShow: 1.9,
  creek: 1.8,
  souk: 1.7,
  duneLine: 1.8,
  burjAlArab: 1.6,
};

export const LANDMARK_PLAN = {
  'bangkok-streets': [
    { id: 'grandPalace', at: 0.42, scale: 2.4, parallax: 0.24 },
    { id: 'watArun', at: 0.78, scale: 2.5, parallax: 0.18 },
  ],
  'bangkok-river': [
    { id: 'watArun', at: 0.36, scale: 2.7, parallax: 0.2 },
    { id: 'marketBoats', at: 0.72, scale: 2.1, parallax: 0.38 },
  ],
  'chiang-lanterns': [
    { id: 'ruins', at: 0.4, scale: 2.3, parallax: 0.22 },
    { id: 'hoiAn', at: 0.74, scale: 2.1, parallax: 0.3 },
  ],
  'chiang-ruins': [{ id: 'ruins', at: 0.45, scale: 2.6, parallax: 0.2 }],
  'phiphi-beach': [
    { id: 'longtailHero', at: 0.4, scale: 1.8, parallax: 0.4 },
    { id: 'phiPhi', at: 0.75, scale: 2.6, parallax: 0.18 },
  ],
  'phiphi-cliffs': [
    { id: 'phiPhi', at: 0.34, scale: 3.1, parallax: 0.16 },
    { id: 'longtailHero', at: 0.7, scale: 1.7, parallax: 0.4 },
  ],
  'hanoi-quarter': [{ id: 'oldQuarter', at: 0.46, scale: 2.4, parallax: 0.26 }],
  'hanoi-lake': [{ id: 'hucBridge', at: 0.48, scale: 2.5, parallax: 0.24 }],
  'hoian-street': [{ id: 'hoiAn', at: 0.42, scale: 2.5, parallax: 0.26 }],
  'hoian-bridge': [{ id: 'japaneseBridge', at: 0.5, scale: 2.4, parallax: 0.24 }],
  'halong-bay': [
    { id: 'haLong', at: 0.36, scale: 3.0, parallax: 0.16 },
    { id: 'junkHero', at: 0.74, scale: 1.85, parallax: 0.38 },
  ],
  'halong-cove': [{ id: 'haLong', at: 0.45, scale: 2.8, parallax: 0.18 }],
  'dubai-road': [{ id: 'burj', at: 0.4, scale: 3.2, parallax: 0.16 }],
  'dubai-fountain': [{ id: 'fountainShow', at: 0.48, scale: 2.5, parallax: 0.22 }],
  'dubai-creek': [{ id: 'creek', at: 0.46, scale: 2.3, parallax: 0.26 }],
  'dubai-souk': [{ id: 'souk', at: 0.48, scale: 2.4, parallax: 0.24 }],
  'dubai-dunes': [{ id: 'duneLine', at: 0.45, scale: 2.6, parallax: 0.2 }],
  'dubai-coast': [{ id: 'burjAlArab', at: 0.42, scale: 2.7, parallax: 0.18 }],
};

export function drawLandmark(ctx, id, x, groundY, height, time, reflect) {
  const paint = LANDMARK_DRAW[id];
  if (!paint) return;
  const cssH = Math.max(40, height);
  const cssW = cssH * (ASPECT[id] || 1);
  const liveOnly = id === 'longtailHero' || id === 'junkHero' || id === 'marketBoats' || id === 'fountainShow' || id === 'creek' || id === 'duneLine';
  const rec = liveOnly
    ? null
    : takeStamp(`lm|${id}|${Math.round(cssH)}`, cssW, cssH, (g, w, h) => {
        g.translate(w / 2, h - 2);
        paint(g, h - 2, 0);
      });
  ctx.save();
  if (rec) ctx.drawImage(rec.canvas, x - cssW / 2, groundY - cssH, cssW, cssH);
  else {
    ctx.translate(x, groundY);
    paint(ctx, cssH, time || 0);
  }
  ctx.restore();
  const overlay = LANDMARK_LIVE[id];
  if (overlay) {
    ctx.save();
    ctx.translate(x, groundY);
    overlay(ctx, cssH, time || 0);
    ctx.restore();
  }
  if (reflect) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - cssW, groundY, cssW * 2, cssH * 0.42);
    ctx.clip();
    ctx.translate(x, groundY + 4);
    ctx.scale(1, -0.36);
    ctx.globalAlpha = 0.28;
    if (rec) ctx.drawImage(rec.canvas, -cssW / 2, 0, cssW, cssH);
    else paint(ctx, cssH, time || 0);
    ctx.restore();
  }
}

function petal(ctx, x, y, rot, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 0, 4, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawAmbience(ctx, biomeId, w, h, groundY, time) {
  const petals = biomeId === 'desert' ? '#e7b56a' : biomeId === 'bangkok' || biomeId === 'hanoi' ? '#f4a3c2' : '#ffe08a';
  if (biomeId === 'bangkok' || biomeId === 'market' || biomeId === 'chiang' || biomeId === 'hanoi' || biomeId === 'desert') {
    const color = petals;
    for (let i = 0; i < 12; i += 1) {
      const x = ((i * 137 + time * (28 + (i % 4) * 10)) % (w + 40) + w + 40) % (w + 40) - 20;
      const y = ((i * 90 + time * (36 + (i % 3) * 8)) % (groundY + 20) + groundY + 20) % (groundY + 20);
      petal(ctx, x, y, time + i, color);
    }
  }
  if (biomeId === 'hoian' || biomeId === 'chiang') {
    for (let i = 0; i < 16; i += 1) {
      const x = (i * 83 + Math.sin(time * 0.6 + i) * 16) % w;
      const y = groundY * (0.25 + ((i * 37) % 60) / 100) + Math.sin(time * 1.4 + i) * 8;
      ctx.globalAlpha = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * 3 + i * 1.7));
      glow(ctx, x, y, 7, 'rgba(255, 214, 120, 0.95)');
      ctx.globalAlpha = 1;
    }
  }
  if (biomeId === 'halong' || biomeId === 'phiphi' || biomeId === 'terraces' || biomeId === 'creek' || biomeId === 'desert') {
    const mistH = 64;
    const rec = takeStamp('mist', 220, mistH, (g, mw, mh) => {
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.beginPath();
      g.ellipse(mw * 0.5, mh * 0.55, mw * 0.42, mh * 0.28, 0, 0, Math.PI * 2);
      g.fill();
    });
    const alpha = biomeId === 'halong' ? 0.7 : 0.4;
    for (let i = 0; i < 4; i += 1) {
      const x = ((i * 280 - time * (18 + i * 6)) % (w + 240) + w + 240) % (w + 240) - 120;
      const y = groundY - 30 - (i % 2) * 24;
      ctx.save();
      ctx.globalAlpha = alpha;
      if (rec) ctx.drawImage(rec.canvas, x, y, 220, mistH);
      ctx.restore();
    }
  }
  if (biomeId === 'phiphi' || biomeId === 'market' || biomeId === 'halong' || biomeId === 'creek' || biomeId === 'downtown') {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (let i = 0; i < 10; i += 1) {
      const x = ((i * 111 - time * 40) % (w + 20) + w + 20) % (w + 20);
      const y = groundY - 18 - (i % 4) * 8 + Math.sin(time * 2 + i) * 2;
      ctx.globalAlpha = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(time * 4 + i));
      ctx.fillRect(x, y, 6, 2);
    }
    ctx.globalAlpha = 1;
  }
}

function drawPerson(ctx, x, y, s, time, shirt, hat) {
  const step = Math.sin(time * 8 + x * 0.01);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = '#3a2418';
  ctx.fillRect(-6, -18, 4, 16 + step * 2);
  ctx.fillRect(3, -18, 4, 16 - step * 2);
  ctx.fillStyle = shirt;
  roundRect(ctx, -8, -36, 16, 18, 4);
  ctx.fill();
  ctx.fillStyle = '#f3c19a';
  ctx.beginPath();
  ctx.arc(0, -42, 6, 0, Math.PI * 2);
  ctx.fill();
  if (hat) {
    ctx.fillStyle = '#f3e2b0';
    ctx.beginPath();
    ctx.moveTo(0, -58);
    ctx.lineTo(10, -42);
    ctx.lineTo(-10, -42);
    ctx.fill();
  }
  ctx.restore();
}

function drawWalkElephant(ctx, x, y, s, time) {
  const step = Math.sin(time * 4);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = '#8d8a96';
  ctx.fillRect(-18, -16, 5, 16 + step);
  ctx.fillRect(-6, -16, 5, 16 - step);
  ctx.fillRect(8, -16, 5, 16 + step);
  ctx.fillRect(18, -16, 5, 16 - step);
  ctx.beginPath();
  ctx.ellipse(0, -28, 26, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  ink(ctx, 1.4);
  ctx.beginPath();
  ctx.ellipse(24, -34, 10, 9, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#8d8a96';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(30, -28);
  ctx.quadraticCurveTo(42, -10, 28, -6);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(28, -36, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawWalkBuffalo(ctx, x, y, s, time) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  const step = Math.sin(time * 6);
  ctx.fillStyle = '#4e5964';
  ctx.fillRect(-16, -14, 5, 14 + step * 2);
  ctx.fillRect(8, -14, 5, 14 - step * 2);
  ctx.beginPath();
  ctx.ellipse(0, -24, 20, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(16, -28, 8, 7, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#f3e6c4';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(12, -34);
  ctx.quadraticCurveTo(4, -46, 6, -34);
  ctx.moveTo(20, -34);
  ctx.quadraticCurveTo(30, -46, 24, -34);
  ctx.stroke();
  ctx.restore();
}

export function drawCrowd(ctx, biomeId, viewW, groundY, time, speed) {
  const kinds = {
    bangkok: ['person', 'person', 'elephant'],
    market: ['vendor', 'person'],
    phiphi: ['person'],
    hoian: ['person', 'person'],
    terraces: ['farmer', 'buffalo'],
    chiang: ['person', 'elephant'],
    hanoi: ['person', 'person'],
    downtown: ['person', 'person'],
    creek: ['vendor', 'person'],
    desert: ['camel', 'person'],
  }[biomeId];
  if (!kinds) return;
  const span = viewW + 280;
  kinds.forEach((kind, i) => {
    const parallax = kind === 'elephant' || kind === 'buffalo' || kind === 'camel' ? 0.32 : 0.62;
    const x = ((i * 340 - time * speed * parallax) % span + span) % span - 60;
    const scale = kind === 'elephant' ? 1.55 : kind === 'buffalo' || kind === 'camel' ? 1.25 : 1.05;
    if (kind === 'elephant') drawWalkElephant(ctx, x, groundY, scale, time);
    else if (kind === 'camel') drawCamels(ctx, x, groundY, 70 * scale, 0.4, time);
    else if (kind === 'buffalo') drawWalkBuffalo(ctx, x, groundY, scale, time);
    else if (kind === 'farmer') drawPerson(ctx, x, groundY, scale, time, '#3aa06a', true);
    else if (kind === 'vendor') drawPerson(ctx, x, groundY, scale, time, '#e25b45', true);
    else drawPerson(ctx, x, groundY, scale, time, i % 2 ? '#3aa6d8' : '#f2c14e', false);
  });
}

function drawFg(ctx, kind, x, y, ph, time) {
  ctx.save();
  if (kind === 'bush') {
    ctx.fillStyle = '#2f9e5a';
    ctx.beginPath();
    ctx.arc(x, y - 16, 18, 0, Math.PI * 2);
    ctx.arc(x + 16, y - 10, 14, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'pot') {
    ctx.fillStyle = '#c4553a';
    ctx.fillRect(x - 10, y - 22, 20, 16);
    ctx.fillStyle = '#2f9e5a';
    ctx.beginPath();
    ctx.arc(x, y - 26, 12, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'basket') {
    ctx.fillStyle = '#c9843a';
    ctx.beginPath();
    ctx.moveTo(x - 16, y - 20);
    ctx.lineTo(x + 16, y - 20);
    ctx.lineTo(x + 10, y);
    ctx.lineTo(x - 10, y);
    ctx.fill();
    ctx.fillStyle = '#f5b423';
    ctx.beginPath();
    ctx.arc(x, y - 22, 6, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'umbrella') {
    drawUmbrellas(ctx, x, y, ph * 0.7, 0.8);
  } else if (kind === 'rock') {
    ctx.fillStyle = '#d9d3c6';
    ctx.beginPath();
    ctx.ellipse(x, y - 10, 22, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ink(ctx, 1.4);
  } else if (kind === 'grass' || kind === 'shoot') {
    ctx.strokeStyle = kind === 'shoot' ? '#b7d96a' : '#3f8f38';
    ctx.lineWidth = 2;
    for (let i = -2; i <= 2; i += 1) {
      ctx.beginPath();
      ctx.moveTo(x + i * 4, y);
      ctx.quadraticCurveTo(x + i * 6, y - 14, x + i * 3, y - 22);
      ctx.stroke();
    }
  } else if (kind === 'lantern') {
    drawLanternShape(ctx, x, y - 36 + Math.sin(time * 2) * 3, 16, '#e23d3d');
  } else if (kind === 'reed') {
    ctx.strokeStyle = '#6a8f62';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 6, y - 20, x - 2, y - 36);
    ctx.stroke();
  }
  ctx.restore();
}

export function groundKind(biomeId) {
  if (biomeId === 'phiphi') return 'sand';
  if (biomeId === 'terraces') return 'paddy';
  if (biomeId === 'market' || biomeId === 'halong') return 'plank';
  return 'street';
}

export function drawForeground(ctx, biomeId, viewW, groundY, time, speed, ph) {
  const kinds = {
    bangkok: ['bush', 'pot', 'bush'],
    market: ['basket', 'umbrella', 'basket'],
    phiphi: ['rock', 'grass', 'rock'],
    hoian: ['lantern', 'bush', 'lantern'],
    halong: ['reed', 'rock', 'reed'],
    terraces: ['shoot', 'grass', 'shoot'],
    chiang: ['lantern', 'bush', 'lantern'],
    hanoi: ['pot', 'bush', 'pot'],
    downtown: ['pot', 'bush', 'pot'],
    creek: ['basket', 'lantern', 'basket'],
    desert: ['grass', 'rock', 'grass'],
  }[biomeId] || ['grass', 'bush'];
  const spacing = Math.max(240, viewW * 0.36);
  const scroll = time * speed * 1.12;
  const y = groundY + Math.min(46, ph * 0.42);
  for (let i = 0; i < kinds.length; i += 1) {
    const span = spacing * kinds.length;
    const x = ((i * spacing - scroll) % span + span) % span - 20;
    drawFg(ctx, kinds[i], x, y, ph, time);
  }
}

export function drawMotion(ctx, w, groundY, rush, time) {
  if (rush < 0.3) return;
  ctx.save();
  ctx.strokeStyle = `rgba(255,255,255,${0.12 + rush * 0.28})`;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (let i = 0; i < 8; i += 1) {
    const y = 28 + ((i * 67) % Math.max(40, groundY - 70));
    const len = 24 + rush * 80;
    const span = w + 200;
    const x = ((i * 160 - time * (360 + rush * 520)) % span + span) % span - 80;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawSpark(ctx, p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot || 0);
  ctx.fillStyle = p.color;
  starPath(ctx, 0, 0, 5 + (p.life / p.max) * 3);
  ctx.fill();
  ctx.restore();
}

export function drawDust(ctx, p) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, p.life / p.max);
  ctx.fillStyle = p.color || 'rgba(120, 92, 58, 0.45)';
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r || 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function island(ctx, x, y, rx, ry, rot, fill, ridge) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ridge;
  ctx.beginPath();
  ctx.ellipse(-rx * 0.1, -ry * 0.15, rx * 0.55, ry * 0.45, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawMapPin(ctx, x, y, time, label, state) {
  const fill = state === 'done' ? '#0c7c74' : state === 'open' ? '#ef5b3a' : '#7d8b96';
  const pulse = state === 'locked' ? 0 : ((time % 1.8) / 1.8);
  ctx.save();
  if (state !== 'locked') {
    ctx.strokeStyle = fill;
    ctx.globalAlpha = 1 - pulse;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 7 + pulse * 14, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  if (state === 'done') {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 3, y);
    ctx.lineTo(x - 1, y + 3);
    ctx.lineTo(x + 4, y - 3);
    ctx.stroke();
  } else if (state === 'locked') {
    ctx.fillRect(x - 3, y - 1, 6, 5);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x, y - 2, 2.2, Math.PI, 0);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(x, y, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#1c2430';
  ctx.font = '700 13px Trebuchet MS, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, x, y - 12);
  ctx.restore();
}

/** Sea, land, and the route. The explorer is drawn by the caller on top. */
export function drawMapBackdrop(ctx, w, h, time) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#8fd4ff');
  sky.addColorStop(0.45, '#d7f3ff');
  sky.addColorStop(1, '#147a86');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  drawSun(ctx, w, h, time, false);
  drawClouds(ctx, w, h, time, false);
  const sea = h * 0.3;
  const water = ctx.createLinearGradient(0, sea, 0, h);
  water.addColorStop(0, '#7ad4d4');
  water.addColorStop(1, '#0e4e5c');
  ctx.fillStyle = water;
  ctx.fillRect(0, sea, w, h - sea);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i += 1) {
    const y = sea + 24 + i * ((h - sea) / 5);
    ctx.beginPath();
    for (let x = 0; x <= w; x += 18) {
      const yy = y + Math.sin(x * 0.02 + time * 1.2 + i) * 3;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }

  const thX = w * 0.2;
  const thY = h * 0.4;
  const vnX = w * 0.46;
  const vnY = h * 0.36;
  const dbX = w * 0.72;
  const dbY = h * 0.42;
  island(ctx, thX, thY, Math.max(78, w * 0.11), h * 0.13, -0.35, '#7dba5a', '#b7d96a');
  island(ctx, thX + w * 0.03, thY + h * 0.08, Math.max(16, w * 0.025), h * 0.05, 0.4, '#7dba5a', '#d6de62');
  island(ctx, vnX, vnY, Math.max(34, w * 0.05), h * 0.16, 0.5, '#5fa84a', '#d6de62');
  island(ctx, dbX, dbY, Math.max(70, w * 0.1), h * 0.1, -0.15, '#e7c27a', '#f6e2b0');
  drawPalms(ctx, thX - 20, thY + 8, Math.min(64, h * 0.1));
  drawKarsts(ctx, vnX + w * 0.04, vnY + 6, Math.min(80, h * 0.14), 0.7);
  drawSail(ctx, dbX + w * 0.04, dbY + 4, Math.min(70, h * 0.12));

  ctx.save();
  ctx.strokeStyle = '#f2c14e';
  ctx.lineWidth = 4;
  ctx.setLineDash([10, 8]);
  ctx.lineDashOffset = -time * 28;
  ctx.beginPath();
  ctx.moveTo(thX + 16, thY - 8);
  ctx.quadraticCurveTo(w * 0.33, h * 0.22, vnX - 6, vnY - 4);
  ctx.quadraticCurveTo(w * 0.58, h * 0.24, dbX - 16, dbY - 6);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = '#1c2430';
  ctx.font = '700 15px Trebuchet MS, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Thailand', thX, thY + h * 0.1);
  ctx.fillText('Vietnam', vnX, vnY + h * 0.12);
  ctx.fillText('Dubai', dbX, dbY + h * 0.09);

  ctx.save();
  ctx.translate(Math.max(36, w * 0.06), h * 0.9);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -22);
  ctx.lineTo(5, -8);
  ctx.lineTo(-5, -8);
  ctx.fill();
  ctx.font = '700 11px Trebuchet MS, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', 0, -26);
  ctx.restore();

  drawBirds(ctx, w, h * 0.45, time);
  drawJunks(ctx, w * 0.62, h * 0.78, 70, 0.4, time);
}
