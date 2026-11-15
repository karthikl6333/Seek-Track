/**
 * Extra souvenirs and hurdles for the city stages.
 * Each one is outlined and shaded the same way as the first set.
 */

function ink(ctx, color, w) {
  ctx.strokeStyle = '#2a2118';
  ctx.lineWidth = w || 1.6;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fillStyle = color;
}

function fillInk(ctx, color, w) {
  ctx.fillStyle = color;
  ctx.fill();
  ink(ctx, color, w);
}

function drawShell(_ctx, x, y, size) {
  const ctx = _ctx;
  ctx.save();
  ctx.translate(x, y);
  const s = size;
  ctx.beginPath();
  ctx.arc(0, s * 0.05, s * 0.38, Math.PI * 0.15, Math.PI * 0.85, true);
  ctx.quadraticCurveTo(0, s * 0.42, s * 0.36, s * 0.08);
  fillInk(ctx, '#f4e2c4', 1.5);
  ctx.strokeStyle = '#e7b27a';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let i = -2; i <= 2; i += 1) {
    ctx.moveTo(0, s * 0.08);
    ctx.quadraticCurveTo(i * s * 0.08, -s * 0.05, i * s * 0.12, -s * 0.22);
  }
  ctx.stroke();
  ctx.fillStyle = '#fffaf0';
  ctx.beginPath();
  ctx.ellipse(-s * 0.08, -s * 0.08, s * 0.08, s * 0.04, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPho(_ctx, x, y, size) {
  const ctx = _ctx;
  ctx.save();
  ctx.translate(x, y);
  const s = size;
  ctx.beginPath();
  ctx.ellipse(0, s * 0.12, s * 0.42, s * 0.22, 0, 0, Math.PI * 2);
  fillInk(ctx, '#f7f1e4', 1.5);
  ctx.beginPath();
  ctx.ellipse(0, s * 0.02, s * 0.32, s * 0.14, 0, 0, Math.PI * 2);
  fillInk(ctx, '#e7c98a', 1.2);
  ctx.strokeStyle = '#f4e2b0';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-s * 0.16, s * 0.02);
  ctx.quadraticCurveTo(0, -s * 0.02, s * 0.16, s * 0.02);
  ctx.stroke();
  ctx.fillStyle = '#3aa06a';
  ctx.beginPath();
  ctx.ellipse(s * 0.08, -s * 0.02, s * 0.08, s * 0.035, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e25b45';
  ctx.fillRect(-s * 0.06, -s * 0.04, s * 0.05, s * 0.04);
  ctx.restore();
}

function drawPearl(_ctx, x, y, size) {
  const ctx = _ctx;
  ctx.save();
  ctx.translate(x, y);
  const s = size;
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.28, 0, Math.PI * 2);
  fillInk(ctx, '#f7f4ee', 1.5);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(-s * 0.08, -s * 0.08, s * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#c9a227';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, s * 0.02, s * 0.16, 0.2, Math.PI - 0.2);
  ctx.stroke();
  ctx.restore();
}

function drawGold(_ctx, x, y, size, time) {
  const ctx = _ctx;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin((time || 0) * 2) * 0.08);
  const s = size;
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.32, 0, Math.PI * 2);
  fillInk(ctx, '#f2c14e', 1.6);
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.2, 0, Math.PI * 2);
  ctx.strokeStyle = '#fff6d2';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#c4553a';
  ctx.font = `700 ${Math.round(s * 0.28)}px Trebuchet MS, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('★', 0, 1);
  ctx.restore();
}

function drawDates(_ctx, x, y, size) {
  const ctx = _ctx;
  ctx.save();
  ctx.translate(x, y);
  const s = size;
  const spots = [
    [-s * 0.16, s * 0.04, 0.2],
    [s * 0.02, -s * 0.08, -0.2],
    [s * 0.16, s * 0.06, 0.4],
  ];
  for (const [dx, dy, rot] of spots) {
    ctx.save();
    ctx.translate(dx, dy);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.16, s * 0.1, 0, 0, Math.PI * 2);
    fillInk(ctx, '#6b3a22', 1.3);
    ctx.fillStyle = '#e7c98a';
    ctx.fillRect(-s * 0.04, -s * 0.015, s * 0.08, s * 0.03);
    ctx.restore();
  }
  ctx.restore();
}

function drawElewalk(ctx, box, time, groundY) {
  const x = box.x + box.w * 0.48;
  const s = Math.min(box.w, box.h * 1.4);
  const step = Math.sin((time || 0) * 8) * 2;
  ctx.save();
  ctx.translate(x, groundY);
  ctx.fillStyle = '#8d8a96';
  ctx.beginPath();
  ctx.ellipse(-s * 0.05, -s * 0.28, s * 0.42, s * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2a2118';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(s * 0.28, -s * 0.42, s * 0.16, s * 0.14, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#f4e2b0';
  ctx.beginPath();
  ctx.ellipse(s * 0.4, -s * 0.4, s * 0.05, s * 0.04, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#5c6b78';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(s * 0.34, -s * 0.34);
  ctx.quadraticCurveTo(s * 0.55, -s * 0.2, s * 0.42, -s * 0.02);
  ctx.stroke();
  ctx.fillStyle = '#7d7a88';
  ctx.fillRect(-s * 0.28, -s * 0.12, s * 0.08, s * 0.14 + step);
  ctx.fillRect(-s * 0.08, -s * 0.12, s * 0.08, s * 0.14 - step);
  ctx.fillRect(s * 0.08, -s * 0.12, s * 0.08, s * 0.14 + step);
  ctx.fillRect(s * 0.22, -s * 0.1, s * 0.07, s * 0.12 - step);
  ctx.restore();
}

function drawCrate(ctx, box, _time, groundY) {
  const w = box.w * 0.7;
  const h = box.h * 0.72;
  const x = box.x + box.w / 2 - w / 2;
  const y = groundY - h;
  ctx.save();
  ctx.fillStyle = '#c4844a';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#2a2118';
  ctx.lineWidth = 1.6;
  ctx.strokeRect(x, y, w, h);
  ctx.strokeStyle = '#8a5a32';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y + h);
  ctx.moveTo(x + w, y);
  ctx.lineTo(x, y + h);
  ctx.stroke();
  ctx.fillStyle = '#e7b27a';
  ctx.fillRect(x, y, w, h * 0.16);
  ctx.restore();
}

function drawStall(ctx, box, _time, groundY) {
  const x = box.x + box.w / 2;
  const w = box.w * 0.8;
  const h = box.h * 0.7;
  ctx.save();
  ctx.translate(x, groundY);
  ctx.fillStyle = '#f7f1e4';
  ctx.fillRect(-w / 2, -h * 0.55, w, h * 0.55);
  ctx.strokeStyle = '#2a2118';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-w / 2, -h * 0.55, w, h * 0.55);
  ctx.fillStyle = '#e23d3d';
  ctx.beginPath();
  ctx.moveTo(-w * 0.62, -h * 0.55);
  ctx.lineTo(0, -h);
  ctx.lineTo(w * 0.62, -h * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#f2c14e';
  ctx.beginPath();
  ctx.arc(-w * 0.18, -h * 0.32, 5, 0, Math.PI * 2);
  ctx.arc(w * 0.12, -h * 0.28, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBuggy(ctx, box, time, groundY) {
  const x = box.x + box.w * 0.5;
  const w = box.w * 0.86;
  const spin = (time || 0) * 10;
  ctx.save();
  ctx.translate(x, groundY);
  ctx.fillStyle = '#ef5b3a';
  ctx.beginPath();
  ctx.moveTo(-w * 0.4, -w * 0.08);
  ctx.lineTo(-w * 0.28, -w * 0.28);
  ctx.lineTo(w * 0.22, -w * 0.32);
  ctx.lineTo(w * 0.42, -w * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#2a2118';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#9fd4ee';
  ctx.fillRect(-w * 0.08, -w * 0.26, w * 0.18, w * 0.1);
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-w * 0.34, -w * 0.16);
  ctx.lineTo(-w * 0.16, -w * 0.16);
  ctx.moveTo(w * 0.18, -w * 0.16);
  ctx.lineTo(w * 0.36, -w * 0.16);
  ctx.stroke();
  wheel(ctx, -w * 0.24, -2, w * 0.12, spin);
  wheel(ctx, w * 0.26, -2, w * 0.12, spin);
  ctx.restore();
}

function wheel(ctx, x, y, r, spin) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#d5dae2';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(spin) * (r - 1), Math.sin(spin) * (r - 1));
  ctx.stroke();
  ctx.restore();
}

function drawBarrier(ctx, box, _time, groundY) {
  const x = box.x + box.w / 2;
  const w = box.w * 0.9;
  ctx.save();
  ctx.translate(x, groundY);
  ctx.fillStyle = '#f2c14e';
  ctx.fillRect(-w / 2, -box.h * 0.85, w, box.h * 0.45);
  ctx.strokeStyle = '#2a2118';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-w / 2, -box.h * 0.85, w, box.h * 0.45);
  ctx.fillStyle = '#1c2430';
  for (let i = -1; i <= 1; i += 1) ctx.fillRect(i * w * 0.22, -box.h * 0.78, w * 0.08, box.h * 0.32);
  ctx.fillStyle = '#8a7058';
  ctx.fillRect(-w * 0.32, -box.h * 0.4, 5, box.h * 0.4);
  ctx.fillRect(w * 0.28, -box.h * 0.4, 5, box.h * 0.4);
  ctx.restore();
}

function drawTaxi(ctx, box, time, groundY) {
  const x = box.x + box.w * 0.5;
  const w = box.w * 0.88;
  const spin = (time || 0) * 12;
  ctx.save();
  ctx.translate(x, groundY);
  ctx.fillStyle = '#f2c14e';
  ctx.fillRect(-w * 0.46, -w * 0.22, w * 0.92, w * 0.2);
  ctx.fillRect(-w * 0.22, -w * 0.4, w * 0.42, w * 0.2);
  ctx.strokeStyle = '#2a2118';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-w * 0.46, -w * 0.22, w * 0.92, w * 0.2);
  ctx.strokeRect(-w * 0.22, -w * 0.4, w * 0.42, w * 0.2);
  ctx.fillStyle = '#9fd4ee';
  ctx.fillRect(-w * 0.16, -w * 0.36, w * 0.14, w * 0.12);
  ctx.fillRect(w * 0.02, -w * 0.36, w * 0.14, w * 0.12);
  ctx.fillStyle = '#1c2430';
  ctx.fillRect(-w * 0.08, -w * 0.46, w * 0.16, w * 0.06);
  wheel(ctx, -w * 0.28, -2, w * 0.1, spin);
  wheel(ctx, w * 0.28, -2, w * 0.1, spin);
  ctx.restore();
}

function drawLamp(ctx, box, time) {
  const cx = box.x + box.w / 2;
  const swing = Math.sin((time || 0) * 2 + cx * 0.01) * 5;
  ctx.save();
  ctx.strokeStyle = '#4a2418';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 36, box.y - 20);
  ctx.quadraticCurveTo(cx, box.y, cx + swing, box.y + box.h * 0.15);
  ctx.stroke();
  ctx.translate(cx + swing, box.y + box.h * 0.55);
  ctx.fillStyle = '#f2c14e';
  ctx.beginPath();
  ctx.moveTo(-12, -16);
  ctx.lineTo(12, -16);
  ctx.lineTo(8, 10);
  ctx.lineTo(-8, 10);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#2a2118';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 220, 120, 0.85)';
  ctx.beginPath();
  ctx.ellipse(0, 16, 10, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawDune(ctx, box, _time, groundY) {
  const cx = box.x + box.w / 2;
  ctx.save();
  ctx.fillStyle = '#e6c27a';
  ctx.beginPath();
  ctx.moveTo(box.x, groundY + 2);
  ctx.quadraticCurveTo(cx, groundY - box.h * 1.6, box.x + box.w, groundY + 2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#2a2118';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.strokeStyle = '#fff6d2';
  ctx.beginPath();
  ctx.moveTo(box.x + box.w * 0.25, groundY - box.h * 0.35);
  ctx.quadraticCurveTo(cx, groundY - box.h * 0.7, box.x + box.w * 0.7, groundY - box.h * 0.2);
  ctx.stroke();
  ctx.restore();
}

function drawBanner(ctx, box, time) {
  const cx = box.x + box.w / 2;
  const wave = Math.sin((time || 0) * 3) * 3;
  ctx.save();
  ctx.strokeStyle = '#6b3a22';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(box.x, box.y);
  ctx.lineTo(box.x + box.w, box.y);
  ctx.stroke();
  ctx.fillStyle = '#0c7c74';
  ctx.beginPath();
  ctx.moveTo(box.x + 4, box.y);
  ctx.quadraticCurveTo(cx, box.y + box.h * 0.35 + wave, box.x + box.w - 4, box.y);
  ctx.lineTo(box.x + box.w - 8, box.y + box.h * 0.85);
  ctx.quadraticCurveTo(cx, box.y + box.h * 0.65 + wave, box.x + 8, box.y + box.h * 0.85);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#2a2118';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.fillStyle = '#f2c14e';
  ctx.fillRect(cx - 10, box.y + box.h * 0.28, 20, 4);
  ctx.restore();
}

export const EXTRA_ITEMS = {
  shell: drawShell,
  pho: drawPho,
  pearl: drawPearl,
  gold: drawGold,
  dates: drawDates,
};

export const EXTRA_HAZARDS = {
  elewalk: drawElewalk,
  crate: drawCrate,
  stall: drawStall,
  buggy: drawBuggy,
  barrier: drawBarrier,
  taxi: drawTaxi,
  lamp: drawLamp,
  dune: drawDune,
  banner: drawBanner,
};
