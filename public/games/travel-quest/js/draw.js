/**
 * Flat vector drawings. No image files: every sprite is painted with canvas shapes.
 * ITEM_DRAW, HAZARD_DRAW, and MOTIF_DRAW keys match js/catalog.js.
 */

const skyCache = { key: '', grad: null };

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
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

export function fillSky(ctx, w, h, top, bottom) {
  const key = `${top}|${bottom}|${w}|${h}`;
  if (key !== skyCache.key) {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    skyCache.key = key;
    skyCache.grad = grad;
  }
  ctx.fillStyle = skyCache.grad;
  ctx.fillRect(0, 0, w, h);
}

function puff(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.arc(x + r * 0.9, y + r * 0.15, r * 0.75, 0, Math.PI * 2);
  ctx.arc(x - r * 0.85, y + r * 0.2, r * 0.65, 0, Math.PI * 2);
  ctx.fill();
}

export function drawClouds(ctx, w, h, time, night) {
  ctx.save();
  ctx.fillStyle = night ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.78)';
  for (let i = 0; i < 5; i += 1) {
    const speed = 14 + i * 4;
    const x = ((i * 240 - time * speed) % (w + 180) + (w + 180)) % (w + 180) - 90;
    const y = h * (0.08 + (i % 3) * 0.07);
    puff(ctx, x, y, 22 + (i % 3) * 8);
  }
  ctx.restore();
}

export function drawSun(ctx, w, h) {
  ctx.save();
  ctx.fillStyle = 'rgba(255, 224, 138, 0.35)';
  ctx.beginPath();
  ctx.arc(w * 0.84, h * 0.15, 48, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffe08a';
  ctx.beginPath();
  ctx.arc(w * 0.84, h * 0.15, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawMoon(ctx, w, h, skyTop) {
  ctx.save();
  ctx.fillStyle = '#fff6d2';
  ctx.beginPath();
  ctx.arc(w * 0.82, h * 0.16, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = skyTop;
  ctx.beginPath();
  ctx.arc(w * 0.82 + 10, h * 0.16 - 4, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawStars(ctx, w, h, time) {
  ctx.save();
  ctx.fillStyle = '#fff6d0';
  for (let i = 0; i < 20; i += 1) {
    const x = (i * 97 + 20) % Math.max(1, w);
    const y = (i * 53 + 12) % Math.max(1, h * 0.42);
    ctx.globalAlpha = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * 2 + i));
    ctx.fillRect(x, y, 2, 2);
  }
  ctx.restore();
}

export function drawBirds(ctx, w, h, time) {
  ctx.save();
  ctx.strokeStyle = 'rgba(40, 48, 60, 0.55)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i += 1) {
    const span = w + 50;
    const x = ((time * (26 + i * 8) + i * 180) % span + span) % span - 20;
    const y = h * (0.14 + 0.05 * Math.sin(time * 0.8 + i));
    const wing = Math.sin(time * 8 + i) * 4;
    ctx.beginPath();
    ctx.moveTo(x - 7, y + wing);
    ctx.quadraticCurveTo(x - 3, y - 4, x, y);
    ctx.quadraticCurveTo(x + 3, y - 4, x + 7, y + wing);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawHills(ctx, w, groundY, color, time) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.38;
  const scroll = (time * 22) % 320;
  for (let i = 0; i < 5; i += 1) {
    const x = ((i * 240 - scroll) % (w + 280) + (w + 280)) % (w + 280) - 120;
    ctx.beginPath();
    ctx.ellipse(x, groundY + 10, 150 + (i % 3) * 24, 64 + (i % 2) * 16, 0, Math.PI, 0);
    ctx.fill();
  }
  ctx.restore();
}

export function drawWater(ctx, w, groundY, time) {
  const top = groundY - 86;
  ctx.save();
  const grad = ctx.createLinearGradient(0, top, 0, groundY);
  grad.addColorStop(0, 'rgba(90, 190, 196, 0.05)');
  grad.addColorStop(1, 'rgba(36, 130, 156, 0.55)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, top, w, 86);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i += 1) {
    const y = top + 22 + i * 20;
    const shift = time * (28 + i * 12);
    ctx.beginPath();
    for (let x = -20; x <= w + 20; x += 10) {
      const yy = y + Math.sin((x + shift) * 0.05 + i) * 3;
      if (x === -20) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  ctx.restore();
}

export function drawGround(ctx, w, h, groundY, ground, groundTop, time, speed) {
  ctx.fillStyle = ground;
  ctx.fillRect(0, groundY, w, Math.max(0, h - groundY));
  ctx.fillStyle = groundTop;
  ctx.fillRect(0, groundY, w, 12);
  ctx.fillStyle = 'rgba(255,255,255,0.38)';
  const period = 56;
  const offset = (time * speed) % period;
  const y = groundY + Math.min(28, (h - groundY) * 0.35);
  for (let x = -period; x < w + period; x += period) {
    ctx.fillRect(x - offset, y, 22, 4);
  }
}

function drawLanternShape(ctx, x, y, s, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.55);
  ctx.bezierCurveTo(s * 0.55, -s * 0.15, s * 0.48, s * 0.35, 0, s * 0.48);
  ctx.bezierCurveTo(-s * 0.48, s * 0.35, -s * 0.55, -s * 0.15, 0, -s * 0.55);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,244,200,0.55)';
  ctx.fillRect(-s * 0.08, -s * 0.18, s * 0.16, s * 0.36);
  ctx.strokeStyle = '#6b3a12';
  ctx.lineWidth = Math.max(1, s * 0.07);
  ctx.beginPath();
  ctx.moveTo(0, s * 0.48);
  ctx.lineTo(0, s * 0.78);
  ctx.stroke();
  ctx.fillStyle = '#f2c14e';
  ctx.fillRect(-s * 0.16, -s * 0.62, s * 0.32, s * 0.1);
  ctx.restore();
}

function drawTemples(ctx, x, y, size, variant) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 110, size / 110);
  ctx.fillStyle = variant > 0.5 ? '#f2d48a' : '#f7e7c1';
  ctx.fillRect(-30, -20, 60, 20);
  ctx.beginPath();
  ctx.moveTo(0, -96);
  ctx.lineTo(18, -20);
  ctx.lineTo(-18, -20);
  ctx.fill();
  ctx.strokeStyle = '#e08a3c';
  ctx.lineWidth = 3;
  for (let i = 0; i < 4; i += 1) {
    const yy = -32 - i * 14;
    const half = 15 - i * 2.4;
    ctx.beginPath();
    ctx.moveTo(-half, yy);
    ctx.lineTo(half, yy);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTuktuks(ctx, x, y, size, variant) {
  const colors = ['#f2c14e', '#e25b45', '#3aa6a0'];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 86, size / 86);
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.arc(-18, -8, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(16, -8, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = colors[Math.floor(variant * 3) % 3];
  roundRect(ctx, -30, -34, 56, 24, 5);
  ctx.fill();
  ctx.fillStyle = '#e9fbff';
  ctx.fillRect(-6, -31, 22, 12);
  ctx.fillStyle = colors[Math.floor(variant * 3) % 3];
  roundRect(ctx, -8, -44, 32, 10, 3);
  ctx.fill();
  ctx.restore();
}

function drawBoats(ctx, x, y, size, variant, time) {
  ctx.save();
  ctx.translate(x, y + Math.sin(time * 1.6 + variant * 6) * 2);
  ctx.scale(size / 78, size / 78);
  ctx.fillStyle = '#8d4b2b';
  ctx.beginPath();
  ctx.moveTo(-36, -12);
  ctx.lineTo(28, -12);
  ctx.lineTo(18, 4);
  ctx.lineTo(-28, 4);
  ctx.fill();
  ctx.fillStyle = variant > 0.5 ? '#f25c54' : '#f2c14e';
  ctx.fillRect(-6, -30, 22, 16);
  ctx.strokeStyle = '#5a3318';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(16, -8);
  ctx.lineTo(42, 10);
  ctx.stroke();
  ctx.restore();
}

function drawAwnings(ctx, x, y, size, variant) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 90, size / 90);
  ctx.strokeStyle = '#6b3a22';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-32, 0);
  ctx.lineTo(-32, -40);
  ctx.moveTo(32, 0);
  ctx.lineTo(32, -40);
  ctx.stroke();
  for (let i = 0; i < 6; i += 1) {
    ctx.fillStyle = (i + (variant > 0.5 ? 1 : 0)) % 2 === 0 ? '#e25b45' : '#f2c14e';
    ctx.beginPath();
    ctx.moveTo(-32 + i * 11, -40);
    ctx.lineTo(-21 + i * 11, -40);
    ctx.lineTo(-24 + i * 11, -18);
    ctx.lineTo(-35 + i * 11, -18);
    ctx.fill();
  }
  ctx.restore();
}

function drawPalms(ctx, x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 120, size / 120);
  ctx.strokeStyle = '#8a5a32';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(16, -40, -2, -74);
  ctx.stroke();
  ctx.strokeStyle = '#2f9e5a';
  ctx.lineWidth = 4;
  for (let i = 0; i < 6; i += 1) {
    const a = -2.5 + i * 0.5;
    ctx.beginPath();
    ctx.moveTo(-2, -74);
    ctx.quadraticCurveTo(Math.cos(a) * 18, -74 + Math.sin(a) * 8, Math.cos(a) * 38, -70 + Math.sin(a) * 20);
    ctx.stroke();
  }
  ctx.restore();
}

function drawUmbrellas(ctx, x, y, size, variant) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 80, size / 80);
  ctx.strokeStyle = '#c9843a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -30);
  ctx.stroke();
  ctx.fillStyle = variant > 0.5 ? '#ef5b6a' : '#3aa6d8';
  ctx.beginPath();
  ctx.arc(0, -30, 28, Math.PI, 0);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.moveTo(0, -30);
  ctx.lineTo(0, -56);
  ctx.stroke();
  ctx.fillStyle = '#f6e2b5';
  ctx.beginPath();
  ctx.ellipse(-6, -2, 18, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawLanternMotif(ctx, x, y, size, variant, time) {
  ctx.save();
  ctx.translate(x, y - size * 0.72);
  ctx.scale(size / 90, size / 90);
  ctx.strokeStyle = '#f2d48a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-46, 0);
  ctx.quadraticCurveTo(0, 16, 46, 4);
  ctx.stroke();
  const colors = ['#e23d3d', '#f2c14e', '#3aa6a0'];
  for (let i = 0; i < 3; i += 1) {
    const ly = 10 + i * 3 + Math.sin(time * 2 + i + variant * 5) * 2;
    drawLanternShape(ctx, -30 + i * 30, ly, 18, colors[i]);
  }
  ctx.restore();
}

function drawShophouses(ctx, x, y, size, variant) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 100, size / 100);
  ctx.fillStyle = variant > 0.5 ? '#f2c14e' : '#f28b6a';
  ctx.fillRect(-34, -62, 68, 62);
  ctx.fillStyle = '#6e2e32';
  ctx.fillRect(-40, -70, 80, 12);
  ctx.fillStyle = '#ffe7a0';
  for (let r = 0; r < 2; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      ctx.globalAlpha = 0.55 + ((r + c) % 2) * 0.45;
      ctx.fillRect(-24 + c * 18, -50 + r * 22, 11, 14);
    }
  }
  ctx.restore();
}

function drawKarsts(ctx, x, y, size, variant) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 130, size / 130);
  ctx.fillStyle = variant > 0.55 ? '#9eb5a6' : '#6e9088';
  ctx.beginPath();
  ctx.moveTo(-36, 0);
  ctx.lineTo(-8, -78 - variant * 36);
  ctx.lineTo(8, -46);
  ctx.lineTo(22, -110);
  ctx.lineTo(48, 0);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.beginPath();
  ctx.moveTo(14, -70);
  ctx.lineTo(24, -40);
  ctx.lineTo(10, -36);
  ctx.fill();
  ctx.restore();
}

function drawJunks(ctx, x, y, size, variant, time) {
  ctx.save();
  ctx.translate(x, y + Math.sin(time * 1.3 + variant * 4) * 2);
  ctx.scale(size / 96, size / 96);
  ctx.fillStyle = '#7a3e24';
  ctx.beginPath();
  ctx.moveTo(-30, -8);
  ctx.lineTo(26, -8);
  ctx.lineTo(16, 8);
  ctx.lineTo(-22, 8);
  ctx.fill();
  ctx.fillStyle = variant > 0.5 ? '#f25c54' : '#f4e2b0';
  ctx.beginPath();
  ctx.moveTo(-2, -8);
  ctx.lineTo(10, -62);
  ctx.lineTo(-26, -22);
  ctx.quadraticCurveTo(-8, -30, -2, -8);
  ctx.fill();
  ctx.fillStyle = '#5a3318';
  ctx.fillRect(-1, -62, 3, 54);
  ctx.restore();
}

function drawTerraces(ctx, x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 110, size / 110);
  const greens = ['#9ad86a', '#6fb34a', '#d6de62', '#3f8f38'];
  for (let i = 0; i < 4; i += 1) {
    ctx.fillStyle = greens[i];
    const yy = -6 - i * 16;
    const half = 50 - i * 8;
    ctx.beginPath();
    ctx.moveTo(-half, yy);
    ctx.lineTo(half, yy);
    ctx.lineTo(half - 8, yy + 12);
    ctx.lineTo(-half + 8, yy + 12);
    ctx.closePath();
    ctx.fill();
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
};

export function drawMotif(ctx, name, x, y, size, variant, time) {
  const draw = MOTIF_DRAW[name];
  if (draw) draw(ctx, x, y, size, variant, time);
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
  ctx.ellipse(0, s * 0.1, s * 0.34, s * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#d7a56a';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#fffaf2';
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.02, s * 0.18, s * 0.1, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#f5b423';
  ctx.beginPath();
  ctx.ellipse(s * 0.02, -s * 0.14, s * 0.22, s * 0.1, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2f9e5a';
  ctx.beginPath();
  ctx.ellipse(-s * 0.16, -s * 0.16, s * 0.08, s * 0.04, -0.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawOrchid(ctx, x, y, size, time) {
  ctx.save();
  ctx.translate(x, y + bob(time, x));
  ctx.strokeStyle = '#2f9e5a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, size * 0.4);
  ctx.lineTo(0, 0);
  ctx.stroke();
  ctx.fillStyle = '#c45ad0';
  for (let i = 0; i < 5; i += 1) {
    ctx.save();
    ctx.rotate((i / 5) * Math.PI * 2);
    ctx.beginPath();
    ctx.ellipse(0, -size * 0.22, size * 0.11, size * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = '#f2c14e';
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawElephant(ctx, x, y, size, time) {
  ctx.save();
  ctx.translate(x, y + bob(time, x));
  const s = size * 0.5;
  ctx.fillStyle = '#f2c14e';
  ctx.beginPath();
  ctx.arc(0, 0, s, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#c4842a';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#6b4a32';
  ctx.beginPath();
  ctx.ellipse(-s * 0.08, s * 0.08, s * 0.38, s * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(s * 0.28, -s * 0.02, s * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(s * 0.1, -s * 0.05, s * 0.14, s * 0.2, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#6b4a32';
  ctx.lineWidth = Math.max(2, s * 0.14);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(s * 0.4, s * 0.08);
  ctx.quadraticCurveTo(s * 0.62, s * 0.28, s * 0.36, s * 0.4);
  ctx.stroke();
  ctx.restore();
}

function drawBanhMi(ctx, x, y, size, time) {
  ctx.save();
  ctx.translate(x, y + bob(time, x));
  ctx.rotate(-0.45);
  const s = size;
  ctx.fillStyle = '#f0c14a';
  roundRect(ctx, -s * 0.42, -s * 0.16, s * 0.84, s * 0.32, s * 0.16);
  ctx.fill();
  ctx.strokeStyle = '#d09a32';
  ctx.stroke();
  ctx.fillStyle = '#3aa06a';
  ctx.fillRect(-s * 0.22, -s * 0.05, s * 0.44, s * 0.07);
  ctx.fillStyle = '#e07a4c';
  ctx.fillRect(-s * 0.12, 0.01 * s, s * 0.3, s * 0.06);
  ctx.restore();
}

function drawLanternItem(ctx, x, y, size, time) {
  ctx.save();
  ctx.translate(0, bob(time, x));
  drawLanternShape(ctx, x, y, size * 0.55, '#e23d3d');
  ctx.restore();
}

function drawHat(ctx, x, y, size, time) {
  ctx.save();
  ctx.translate(x, y + bob(time, x));
  const s = size;
  ctx.fillStyle = '#f3e2b0';
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.42);
  ctx.lineTo(s * 0.48, s * 0.22);
  ctx.lineTo(-s * 0.48, s * 0.22);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#e0c48a';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = '#e25b45';
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
};

export function drawItem(ctx, glyph, x, y, size, time) {
  const draw = ITEM_DRAW[glyph];
  if (draw) draw(ctx, x, y, size, time);
}

function drawPothole(ctx, box, _time, groundY) {
  const cx = box.x + box.w / 2;
  ctx.save();
  ctx.fillStyle = '#6a5138';
  ctx.beginPath();
  ctx.ellipse(cx, groundY + 2, box.w * 0.62, box.h * 0.95, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2c2118';
  ctx.beginPath();
  ctx.ellipse(cx, groundY + 3, box.w * 0.4, box.h * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawWheel(ctx, x, y, spin) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.arc(0, 0, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#d5dae2';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(spin) * 5, Math.sin(spin) * 5);
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
  drawWheel(ctx, -16, -8, spin);
  drawWheel(ctx, 16, -8, spin);
  ctx.strokeStyle = '#d9dde3';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-16, -8);
  ctx.lineTo(16, -8);
  ctx.lineTo(20, -28);
  ctx.stroke();
  ctx.fillStyle = '#3aa6d8';
  roundRect(ctx, -18, -26, 28, 16, 4);
  ctx.fill();
  ctx.fillStyle = '#f3c19a';
  ctx.beginPath();
  ctx.arc(-2, -34, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e25b45';
  ctx.beginPath();
  ctx.arc(-2, -36, 6.5, Math.PI, 0);
  ctx.fill();
  ctx.restore();
}

function drawSign(ctx, box, _time, groundY) {
  const cx = box.x + box.w / 2;
  ctx.save();
  ctx.strokeStyle = '#6b3a22';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, groundY);
  ctx.lineTo(cx, box.y + box.h);
  ctx.stroke();
  ctx.fillStyle = '#f2c14e';
  roundRect(ctx, box.x, box.y, box.w, box.h, 6);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#e25b45';
  ctx.stroke();
  ctx.fillStyle = '#e25b45';
  ctx.beginPath();
  ctx.arc(cx, box.y + box.h * 0.58, Math.min(box.w, box.h) * 0.18, 0, Math.PI);
  ctx.fill();
  ctx.restore();
}

function drawPuddle(ctx, box, _time, groundY) {
  const cx = box.x + box.w / 2;
  ctx.save();
  ctx.fillStyle = '#4aa3d8';
  ctx.beginPath();
  ctx.ellipse(cx, groundY + 1, box.w * 0.6, box.h * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(cx - box.w * 0.08, groundY - 1, box.w * 0.2, box.h * 0.3, -0.6, Math.PI * 1.1, Math.PI * 1.9);
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
  ctx.fillRect(-18, -16, 6, 16 + step * 2);
  ctx.fillRect(-6, -16, 6, 16 - step * 2);
  ctx.fillRect(8, -16, 6, 16 + step * 2);
  ctx.fillRect(18, -16, 6, 16 - step * 2);
  ctx.beginPath();
  ctx.ellipse(0, -30, 26, 15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(24, -36, 12, 10, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#f3e6c4';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(18, -44);
  ctx.quadraticCurveTo(8, -58, 6, -46);
  ctx.moveTo(28, -44);
  ctx.quadraticCurveTo(40, -58, 36, -44);
  ctx.stroke();
  ctx.fillStyle = '#1c2430';
  ctx.beginPath();
  ctx.arc(28, -38, 1.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHangLantern(ctx, box, time) {
  const cx = box.x + box.w / 2;
  const swing = Math.sin(time * 2.2 + cx * 0.01) * 3;
  ctx.save();
  ctx.strokeStyle = '#f2d48a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 36, box.y - 36);
  ctx.quadraticCurveTo(cx, box.y - 8, cx + swing, box.y + 2);
  ctx.stroke();
  drawLanternShape(ctx, cx + swing, box.y + box.h * 0.5, Math.min(box.w, box.h) * 0.72, '#e23d3d');
  ctx.restore();
}

export const HAZARD_DRAW = {
  pothole: drawPothole,
  scooter: drawScooter,
  sign: drawSign,
  puddle: drawPuddle,
  buffalo: drawBuffalo,
  hanglantern: drawHangLantern,
};

export function drawHazard(ctx, glyph, box, time, groundY) {
  const draw = HAZARD_DRAW[glyph];
  if (draw) draw(ctx, box, time, groundY);
}

export function drawGate(ctx, x, groundY, h, accent) {
  ctx.save();
  ctx.translate(x, groundY);
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
  roundRect(ctx, -40, top - 18, 80, 18, 4);
  ctx.fill();
  ctx.fillStyle = '#fff';
  star(ctx, 0, top - 9, 7);
  ctx.restore();
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

export function drawShrine(ctx, x, groundY, h, accent) {
  ctx.save();
  ctx.translate(x, groundY);
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(-4, -h * 0.55, 8, h * 0.55);
  ctx.beginPath();
  ctx.arc(0, -h * 0.62, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  star(ctx, 0, -h * 0.62, 5);
  ctx.restore();
}

/**
 * The explorer is the approved drawing (assets/explorer-idle.png and
 * explorer-run.png). Jump and duck are that same picture, tilted or cropped.
 */
const SPRITE_URL = {
  idle: new URL('../assets/explorer-idle.png', import.meta.url).href,
  run: new URL('../assets/explorer-run.png', import.meta.url).href,
};
const sprites = { idle: null, run: null };

function ensureSprites() {
  if (sprites.idle || typeof Image === 'undefined') return;
  for (const key of ['idle', 'run']) {
    const img = new Image();
    img.decoding = 'async';
    img.src = SPRITE_URL[key];
    sprites[key] = img;
  }
}

function spriteReady(img) {
  return Boolean(img && img.complete && img.naturalWidth);
}

function paintSprite(ctx, img, anchor, dw, dh, top) {
  ctx.drawImage(img, -dw * anchor, top, dw, dh);
}

function drawLoaded(ctx, img, anchor, h, pose, time) {
  const aspect = img.naturalWidth / img.naturalHeight;
  const dw = h * aspect;
  const dh = h;
  ctx.save();
  if (pose === 'idle') {
    ctx.translate(0, Math.sin(time * 2.3) * h * 0.012);
    paintSprite(ctx, img, anchor, dw, dh, -dh);
  } else if (pose === 'jump') {
    ctx.rotate(-0.2);
    ctx.translate(0, -h * 0.05);
    ctx.scale(0.97, 0.9);
    paintSprite(ctx, img, anchor, dw, dh, -dh);
  } else if (pose === 'duck') {
    const split = 0.42;
    const headH = h * 0.4;
    const bodyH = h * 0.26;
    const srcH = img.naturalHeight;
    ctx.drawImage(
      img,
      0,
      srcH * split,
      img.naturalWidth,
      srcH * (1 - split),
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
      srcH * split,
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

export function drawTraveller(ctx, x, footY, h, pose, time, alpha) {
  ensureSprites();
  const idlePose = pose === 'idle';
  const img = idlePose ? sprites.idle : sprites.run;
  ctx.save();
  ctx.translate(x, footY);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(74, 36, 24, 0.16)';
  ctx.beginPath();
  ctx.ellipse(0, 4, h * 0.22, h * 0.045, 0, 0, Math.PI * 2);
  ctx.fill();
  if (spriteReady(img)) {
    drawLoaded(ctx, img, idlePose ? 0.54 : 0.81, h, pose, time);
  }
  ctx.restore();
}

export function drawCheckpoint(ctx, x, groundY, h) {
  ctx.save();
  ctx.translate(x, groundY);
  ctx.fillStyle = '#4A2418';
  ctx.fillRect(-3, -h * 1.15, 6, h * 1.15);
  ctx.fillStyle = '#D0182F';
  ctx.beginPath();
  ctx.moveTo(3, -h * 1.15);
  ctx.lineTo(h * 0.42, -h * 0.96);
  ctx.lineTo(3, -h * 0.76);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#EBC98F';
  ctx.beginPath();
  ctx.ellipse(0, 2, h * 0.12, h * 0.04, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawMapScene(ctx, w, h, time) {
  fillSky(ctx, w, h, '#8fd4ff', '#ffe3bf');
  drawSun(ctx, w, h);
  drawClouds(ctx, w, h, time, false);
  drawBirds(ctx, w, h * 0.7, time);
  const sea = h * 0.58;
  const grad = ctx.createLinearGradient(0, sea, 0, h);
  grad.addColorStop(0, '#49c4c8');
  grad.addColorStop(1, '#1f7e9a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, sea, w, h - sea);
  ctx.fillStyle = '#7dba5a';
  ctx.beginPath();
  ctx.ellipse(w * 0.28, h * 0.7, Math.max(70, w * 0.16), h * 0.12, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(w * 0.72, h * 0.66, Math.max(80, w * 0.18), h * 0.13, 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f0d48a';
  ctx.beginPath();
  ctx.ellipse(w * 0.28, h * 0.75, Math.max(50, w * 0.1), h * 0.035, 0, 0, Math.PI * 2);
  ctx.fill();
  drawPalms(ctx, w * 0.18, h * 0.72, Math.min(140, h * 0.26));
  drawKarsts(ctx, w * 0.84, h * 0.62, Math.min(150, h * 0.28), 0.4);
  const figure = Math.min(200, Math.max(120, h * 0.34));
  drawTraveller(ctx, Math.max(78, w * 0.12), h * 0.8, figure, 'idle', time, 1);
  drawTraveller(ctx, Math.min(w - 70, w * 0.9), h * 0.78, figure * 0.86, 'run', time, 1);
}
