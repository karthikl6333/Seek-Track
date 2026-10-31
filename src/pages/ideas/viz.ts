/**
 * Inline-SVG charts and flowcharts for Ideas reports (no library, no CDN, no inline styles, so they work
 * under the app's auth and CSP and take the theme from CSS variables in ideas.css).
 *
 * A report embeds one with a fenced block whose language is `viz` and whose body is JSON:
 *
 *   ```viz
 *   { "type": "bar", "title": "...", "items": [{ "label": "A", "value": 3, "display": "$3M" }] }
 *   ```
 *
 * Types: bar (single or grouped), stacked, funnel, circles, line, scatter, flow. The numbers are always
 * the ones written in the spec (`display` is the text shown, `value` only sets the length); nothing is
 * computed or interpolated here. renderViz() returns trusted HTML (all text is escaped) that still goes
 * through the sanitizer like the rest of the report. It throws on a bad spec so the caller can show it.
 */

const esc = (s: unknown): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = (n: number): string => String(Math.round(n * 10) / 10);

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function reqStr(o: Obj, k: string, where: string, max = 400): string {
  const v = o[k];
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error(`${where}: "${k}" must be a non-empty string`);
  return v;
}
function optStr(o: Obj, k: string, max = 600): string | undefined {
  const v = o[k];
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || v.length > max) throw new Error(`"${k}" must be a string`);
  return v;
}
function reqNum(o: Obj, k: string, where: string): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${where}: "${k}" must be a number`);
  return v;
}
function optNum(o: Obj, k: string): number | undefined {
  const v = o[k];
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`"${k}" must be a number`);
  return v;
}
function arr(o: Obj, k: string, min: number, max: number): Obj[] {
  const v = o[k];
  if (!Array.isArray(v) || v.length < min || v.length > max || !v.every(isObj)) {
    throw new Error(`"${k}" must be a list of ${min} to ${max} objects`);
  }
  return v as Obj[];
}

/** Rough text width for the sans font used in the app (avg glyph about 0.56 em). */
const tw = (s: string, size: number): number => s.length * size * 0.56;

/** Word-wraps to at most `maxPx` per line (a single long word stays whole). */
function wrap(text: string, maxPx: number, size: number): string[] {
  const maxChars = Math.max(6, Math.floor(maxPx / (size * 0.56)));
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + word).length > maxChars) {
      out.push(line);
      line = word;
    } else line = line ? line + ' ' + word : word;
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}

/** Multi-line <text>, vertically centred on cy. */
function textBlock(lines: string[], x: number, cy: number, lh: number, cls: string, anchor: 'start' | 'middle' | 'end' = 'middle'): string {
  const y0 = cy - ((lines.length - 1) * lh) / 2;
  return lines
    .map((l, i) => `<text class="${cls}" x="${f(x)}" y="${f(y0 + i * lh)}" text-anchor="${anchor}" dominant-baseline="central">${esc(l)}</text>`)
    .join('');
}

const MINW = [0, 480, 560, 640, 720, 800, 900, 1000];

interface Fig {
  kind: string;
  title?: string;
  note?: string;
  legend?: string[];
  label: string;
  W: number;
  H: number;
  inner: string;
}

function figure(fig: Fig): string {
  const need = fig.W * 0.8;
  const min = MINW.find((m) => m >= need) ?? 1000;
  const legend = fig.legend?.length
    ? `<ul class="idea-viz-legend">${fig.legend
        .map((l, i) => `<li><i class="viz-sw viz-f${i % 6}"></i>${esc(l)}</li>`)
        .join('')}</ul>`
    : '';
  return (
    `<figure class="idea-viz idea-viz-${fig.kind}">` +
    (fig.title ? `<figcaption class="idea-viz-title">${esc(fig.title)}</figcaption>` : '') +
    legend +
    `<div class="idea-viz-scroll idea-viz-min-${min}">` +
    `<svg class="viz" viewBox="0 0 ${f(fig.W)} ${f(fig.H)}" role="img" aria-label="${esc(fig.label)}">` +
    `<title>${esc(fig.label)}</title>${fig.inner}</svg></div>` +
    (fig.note ? `<p class="idea-viz-note">${esc(fig.note)}</p>` : '') +
    `</figure>`
  );
}

const colorOf = (o: Obj, fallback: number): number => {
  const c = optNum(o, 'c');
  return (c === undefined ? fallback : c) % 6;
};

// ---------------------------------------------------------------- bar (single or grouped)

function bar(spec: Obj): string {
  const items = arr(spec, 'items', 1, 30);
  const series = Array.isArray(spec.series) ? (spec.series as unknown[]).map(String) : null;
  const nS = series?.length ?? 1;
  const W = 720;
  const LW = 230;
  const barX = LW + 18;
  const rows = items.map((it, i) => {
    const where = `items[${i}]`;
    const label = reqStr(it, 'label', where);
    const values = nS > 1 ? (it.values as unknown) : [it.value];
    if (!Array.isArray(values) || values.length !== nS || !values.every((v) => v === null || (typeof v === 'number' && Number.isFinite(v)))) {
      throw new Error(`${where}: needs ${nS > 1 ? '"values" with one number per series' : '"value"'}`);
    }
    const displays = nS > 1 ? (it.displays as unknown) : [it.display];
    const est = nS > 1 ? it.estimates : [it.estimate];
    return {
      label,
      lines: wrap(label, LW - 8, 13),
      values: values as (number | null)[],
      displays: Array.isArray(displays) ? displays.map((d) => (d == null ? '' : String(d))) : [],
      est: Array.isArray(est) ? est.map(Boolean) : [],
      c: colorOf(it, 0),
    };
  });
  const longest = Math.max(...rows.flatMap((r) => r.displays.map((d) => tw(d, 12))), 40);
  const maxBar = W - barX - Math.min(300, Math.max(80, longest + 18));
  const max = optNum(spec, 'max') ?? Math.max(...rows.flatMap((r) => r.values.filter((v): v is number => v !== null)), 1e-9);
  const rowHs = rows.map((r) => Math.max(nS * 20 + 14, r.lines.length * 16 + 12));
  const top = 6;
  let y = top;
  let inner = '';
  rows.forEach((r, i) => {
    const h = rowHs[i];
    inner += textBlock(r.lines, LW, y + h / 2, 16, 'viz-label', 'end');
    r.values.forEach((v, s) => {
      if (v === null) return;
      const by = y + (h - nS * 20) / 2 + s * 20 + 2;
      const w = Math.max(v > 0 ? 2 : 0, (v / max) * maxBar);
      const cls = `viz-f${nS > 1 ? s % 6 : r.c}${r.est[s] ? ' viz-est' : ''}`;
      const shown = r.displays[s] || String(v);
      inner += `<rect class="${cls}" x="${barX}" y="${f(by)}" width="${f(w)}" height="16" rx="3"><title>${esc(r.label)}${series ? ' (' + esc(series[s]) + ')' : ''}: ${esc(shown)}</title></rect>`;
      inner += `<text class="viz-val" x="${f(barX + w + 8)}" y="${f(by + 8)}" dominant-baseline="central">${esc(shown)}</text>`;
    });
    y += h;
  });
  inner = `<line class="viz-axis" x1="${barX}" y1="${top}" x2="${barX}" y2="${y}"/>` + inner;
  const label = `${spec.title ?? 'Bar chart'}: ` + rows.map((r) => `${r.label} ${r.displays.join(' / ')}`).join('; ');
  return figure({
    kind: 'bar',
    title: optStr(spec, 'title'),
    note: optStr(spec, 'note'),
    legend: series ?? undefined,
    label,
    W,
    H: y + top,
    inner,
  });
}

// ---------------------------------------------------------------- stacked

function stacked(spec: Obj): string {
  const rows = arr(spec, 'rows', 1, 16);
  const normalize = spec.normalize !== false;
  const W = 720;
  const LW = 230;
  const barX = LW + 18;
  const barW = W - barX - 84;
  const legend: string[] = [];
  const parsed = rows.map((r, i) => {
    const label = reqStr(r, 'label', `rows[${i}]`);
    const parts = arr(r, 'parts', 1, 8).map((p, j) => {
      const l = reqStr(p, 'label', `rows[${i}].parts[${j}]`);
      if (!legend.includes(l)) legend.push(l);
      return { label: l, value: reqNum(p, 'value', `rows[${i}].parts[${j}]`), display: optStr(p, 'display') };
    });
    return { label, parts, total: optStr(r, 'total') };
  });
  const denomFor = (parts: { value: number }[]): number =>
    normalize ? parts.reduce((a, p) => a + p.value, 0) || 1 : (optNum(spec, 'max') ?? 1);
  const rowH = 38;
  let inner = '';
  parsed.forEach((r, i) => {
    const y = 6 + i * rowH;
    const lines = wrap(r.label, LW - 8, 13);
    inner += textBlock(lines, LW, y + rowH / 2, 15, 'viz-label', 'end');
    const denom = denomFor(r.parts);
    if (!normalize) inner += `<rect class="viz-track" x="${barX}" y="${y + 5}" width="${f(barW)}" height="26" rx="4"/>`;
    let x = barX;
    for (const p of r.parts) {
      const w = (p.value / denom) * barW;
      const shown = p.display ?? String(p.value);
      inner += `<rect class="viz-f${legend.indexOf(p.label) % 6}" x="${f(x)}" y="${y + 5}" width="${f(w)}" height="26"><title>${esc(r.label)}: ${esc(p.label)} ${esc(shown)}</title></rect>`;
      if (w > tw(shown, 12) + 10) inner += `<text class="viz-seg" x="${f(x + w / 2)}" y="${y + 18.5}" text-anchor="middle" dominant-baseline="central">${esc(shown)}</text>`;
      x += w;
    }
    if (r.total) inner += `<text class="viz-val" x="${f(barX + barW + 10)}" y="${y + 18.5}" dominant-baseline="central">${esc(r.total)}</text>`;
  });
  const label = `${spec.title ?? 'Stacked bars'}: ` + parsed.map((r) => `${r.label}: ${r.parts.map((p) => `${p.label} ${p.display ?? p.value}`).join(', ')}`).join('; ');
  return figure({
    kind: 'stacked',
    title: optStr(spec, 'title'),
    note: optStr(spec, 'note'),
    legend,
    label,
    W,
    H: 12 + parsed.length * rowH,
    inner,
  });
}

// ---------------------------------------------------------------- funnel (not to scale)

function funnel(spec: Obj): string {
  const cols = arr(spec, 'columns', 1, 3);
  const colW = 330;
  const gap = 50;
  const W = cols.length * colW + (cols.length - 1) * gap + 20;
  const frac = [1, 0.8, 0.62, 0.48, 0.38];
  const parsed = cols.map((c, i) => ({
    heading: reqStr(c, 'heading', `columns[${i}]`),
    levels: arr(c, 'levels', 1, 5).map((l, j) => ({
      tag: reqStr(l, 'tag', `columns[${i}].levels[${j}]`, 20),
      value: reqStr(l, 'value', `columns[${i}].levels[${j}]`, 60),
      label: optStr(l, 'label') ?? '',
      status: optStr(l, 'status', 60),
      estimate: l.estimate === true,
    })),
  }));
  const maxLevels = Math.max(...parsed.map((c) => c.levels.length));
  // Level height from the longest label at the narrowest width.
  const blockH = 104;
  const top = 34;
  let inner = '';
  parsed.forEach((c, ci) => {
    const x0 = 10 + ci * (colW + gap);
    const cx = x0 + colW / 2;
    inner += `<text class="viz-head" x="${f(cx)}" y="14" text-anchor="middle">${esc(c.heading)}</text>`;
    c.levels.forEach((l, li) => {
      const wTop = colW * frac[li];
      const wBot = colW * (frac[li + 1] ?? frac[li] * 0.82);
      const y = top + li * (blockH + 6);
      const pts = [
        [cx - wTop / 2, y],
        [cx + wTop / 2, y],
        [cx + wBot / 2, y + blockH],
        [cx - wBot / 2, y + blockH],
      ]
        .map((p) => `${f(p[0])},${f(p[1])}`)
        .join(' ');
      inner += `<polygon class="viz-f${li % 6}${l.estimate ? ' viz-est' : ''}" points="${pts}"><title>${esc(l.tag)} ${esc(l.value)} ${esc(l.label)}</title></polygon>`;
      const tx = Math.max(60, wBot - 24);
      const lines = wrap(l.label, tx, 11).slice(0, 2);
      let t = '';
      t += `<text class="viz-fun-tag" x="${f(cx)}" y="${f(y + 14)}" text-anchor="middle" dominant-baseline="central">${esc(l.tag)}</text>`;
      t += `<text class="viz-fun-value" x="${f(cx)}" y="${f(y + 34)}" text-anchor="middle" dominant-baseline="central">${esc(l.value)}</text>`;
      t += textBlock(lines, cx, y + 54 + ((lines.length - 1) * 13) / 2, 13, 'viz-fun-label', 'middle');
      if (l.status) t += `<text class="viz-fun-status" x="${f(cx)}" y="${f(y + blockH - 9)}" text-anchor="middle" dominant-baseline="central">${esc(l.status)}</text>`;
      inner += l.estimate ? `<g class="viz-fun-est">${t}</g>` : t;
    });
  });
  const H = top + maxLevels * (blockH + 6) + 4;
  const label = `${spec.title ?? 'Funnel'}: ` + parsed.map((c) => `${c.heading}: ${c.levels.map((l) => `${l.tag} ${l.value}`).join(', ')}`).join('; ');
  return figure({ kind: 'funnel', title: optStr(spec, 'title'), note: optStr(spec, 'note'), label, W, H, inner });
}

// ---------------------------------------------------------------- circles (area proportional to value)

function circles(spec: Obj): string {
  const items = arr(spec, 'items', 2, 5).map((it, i) => ({
    tag: reqStr(it, 'tag', `items[${i}]`, 20),
    value: reqNum(it, 'value', `items[${i}]`),
    display: reqStr(it, 'display', `items[${i}]`, 60),
    label: optStr(it, 'label') ?? '',
    estimate: it.estimate === true,
  }));
  items.sort((a, b) => b.value - a.value);
  const R = 150;
  const cx = R + 10;
  const baseY = 2 * R + 14;
  const W = 720;
  let inner = '';
  const slotGap = 62;
  const labelX = 380;
  items.forEach((it, i) => {
    const r = R * Math.sqrt(it.value / items[0].value);
    const topY = baseY - 2 * r;
    inner += `<circle class="viz-f${i % 6} viz-circle${it.estimate ? ' viz-est' : ''}" cx="${f(cx)}" cy="${f(baseY - r)}" r="${f(r)}"><title>${esc(it.tag)} ${esc(it.display)}</title></circle>`;
    const slotY = 40 + i * slotGap;
    inner += `<polyline class="viz-edge" fill="none" points="${f(cx)},${f(topY)} ${f(cx + R + 18)},${f(topY)} ${labelX - 14},${f(slotY)} ${labelX - 4},${f(slotY)}"/>`;
    inner += `<circle class="viz-f${i % 6}" cx="${f(cx)}" cy="${f(topY)}" r="3"/>`;
    inner += `<text class="viz-head-left" x="${labelX}" y="${f(slotY - 12)}" dominant-baseline="central">${esc(it.tag)}  ${esc(it.display)}</text>`;
    inner += textBlock(wrap(it.label, W - labelX - 8, 12).slice(0, 3), labelX, slotY + 6 + ((wrap(it.label, W - labelX - 8, 12).slice(0, 3).length - 1) * 15) / 2, 15, 'viz-label', 'start');
  });
  const label = `${spec.title ?? 'Nested circles'}: ` + items.map((i) => `${i.tag} ${i.display}`).join('; ');
  return figure({ kind: 'circles', title: optStr(spec, 'title'), note: optStr(spec, 'note'), label, W, H: baseY + 8, inner });
}

// ---------------------------------------------------------------- line

function line(spec: Obj): string {
  const pts = arr(spec, 'points', 2, 24).map((p, i) => ({
    x: reqStr(p, 'x', `points[${i}]`, 30),
    at: optNum(p, 'at'),
    y: reqNum(p, 'y', `points[${i}]`),
    display: optStr(p, 'display', 40),
    estimate: p.estimate === true,
  }));
  const W = 720;
  const H = 320;
  const ml = 58;
  const mr = 36;
  const mt = 34;
  const mb = 44;
  const prefix = optStr(spec, 'yPrefix', 8) ?? '';
  const suffix = optStr(spec, 'ySuffix', 8) ?? '';
  const ymax = optNum(spec, 'yMax') ?? Math.max(...pts.map((p) => p.y)) * 1.1;
  const nice = Math.ceil(ymax / 5) * 5 || 1;
  const ticks = 4;
  const xs = pts.map((p, i) => p.at ?? i);
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);
  const X = (v: number): number => ml + ((v - xmin) / (xmax - xmin || 1)) * (W - ml - mr);
  const Y = (v: number): number => mt + (1 - v / nice) * (H - mt - mb);
  let inner = '';
  for (let t = 0; t <= ticks; t++) {
    const v = (nice / ticks) * t;
    inner += `<line class="viz-grid" x1="${ml}" y1="${f(Y(v))}" x2="${W - mr}" y2="${f(Y(v))}"/>`;
    inner += `<text class="viz-tick" x="${ml - 8}" y="${f(Y(v))}" text-anchor="end" dominant-baseline="central">${esc(prefix + f(v) + suffix)}</text>`;
  }
  // segments: dashed when either end is an estimate
  for (let i = 1; i < pts.length; i++) {
    const dashed = pts[i].estimate || pts[i - 1].estimate;
    inner += `<line class="viz-series${dashed ? ' viz-dash' : ''}" x1="${f(X(xs[i - 1]))}" y1="${f(Y(pts[i - 1].y))}" x2="${f(X(xs[i]))}" y2="${f(Y(pts[i].y))}"/>`;
  }
  pts.forEach((p, i) => {
    const x = X(xs[i]);
    const y = Y(p.y);
    inner += `<circle class="${p.estimate ? 'viz-dot-est' : 'viz-dot'}" cx="${f(x)}" cy="${f(y)}" r="5"><title>${esc(p.x)}: ${esc(p.display ?? p.y)}${p.estimate ? ' (estimate)' : ''}</title></circle>`;
    // the first label sits to the right of its point so it cannot collide with the y-axis ticks
    inner += `<text class="viz-val" x="${f(i === 0 ? x + 8 : x)}" y="${f(y - 14)}" text-anchor="${i === 0 ? 'start' : 'middle'}">${esc(p.display ?? p.y)}</text>`;
    inner += `<text class="viz-tick" x="${f(x)}" y="${H - mb + 20}" text-anchor="middle">${esc(p.x)}</text>`;
  });
  const label = `${spec.title ?? 'Line chart'}: ` + pts.map((p) => `${p.x} ${p.display ?? p.y}`).join(', ');
  return figure({ kind: 'line', title: optStr(spec, 'title'), note: optStr(spec, 'note'), label, W, H, inner });
}

// ---------------------------------------------------------------- scatter (quadrants)

function scatter(spec: Obj): string {
  const pts = arr(spec, 'points', 1, 20).map((p, i) => ({
    label: reqStr(p, 'label', `points[${i}]`, 60),
    x: reqNum(p, 'x', `points[${i}]`),
    y: reqNum(p, 'y', `points[${i}]`),
  }));
  const W = 720;
  const H = 400;
  const ml = 54;
  const mr = 20;
  const mt = 14;
  const mb = 46;
  const pw = W - ml - mr;
  const ph = H - mt - mb;
  const X = (v: number): number => ml + v * pw;
  const Y = (v: number): number => mt + (1 - v) * ph;
  const xl = optStr(spec, 'xLabel', 60) ?? '';
  const yl = optStr(spec, 'yLabel', 60) ?? '';
  const q = Array.isArray(spec.quadrants) ? (spec.quadrants as unknown[]).map(String) : [];
  let inner = `<rect class="viz-track" x="${ml}" y="${mt}" width="${pw}" height="${ph}" rx="4"/>`;
  inner += `<line class="viz-grid" x1="${f(X(0.5))}" y1="${mt}" x2="${f(X(0.5))}" y2="${mt + ph}"/><line class="viz-grid" x1="${ml}" y1="${f(Y(0.5))}" x2="${ml + pw}" y2="${f(Y(0.5))}"/>`;
  if (q.length === 4) {
    // order: top-left, top-right, bottom-left, bottom-right
    const pos = [
      [ml + 8, mt + 14, 'start'],
      [ml + pw - 8, mt + 14, 'end'],
      [ml + 8, mt + ph - 8, 'start'],
      [ml + pw - 8, mt + ph - 8, 'end'],
    ] as const;
    q.forEach((t, i) => (inner += `<text class="viz-quad" x="${pos[i][0]}" y="${pos[i][1]}" text-anchor="${pos[i][2]}">${esc(t)}</text>`));
  }
  inner += `<text class="viz-tick" x="${f(ml + pw / 2)}" y="${H - 10}" text-anchor="middle">${esc(xl)}</text>`;
  inner += `<text class="viz-tick" x="14" y="${f(mt + ph / 2)}" text-anchor="middle" transform="rotate(-90 14 ${f(mt + ph / 2)})">${esc(yl)}</text>`;
  pts.forEach((p, i) => {
    const x = X(p.x);
    const y = Y(p.y);
    const left = x + tw(p.label, 12) + 20 > W - mr;
    inner += `<circle class="viz-f${i % 6} viz-pt" cx="${f(x)}" cy="${f(y)}" r="7"><title>${esc(p.label)} (${p.x}, ${p.y})</title></circle>`;
    inner += `<text class="viz-label" x="${f(left ? x - 12 : x + 12)}" y="${f(y)}" text-anchor="${left ? 'end' : 'start'}" dominant-baseline="central">${esc(p.label)}</text>`;
  });
  const label = `${spec.title ?? 'Scatter'}: ` + pts.map((p) => `${p.label} (${xl} ${p.x}, ${yl} ${p.y})`).join('; ');
  return figure({ kind: 'scatter', title: optStr(spec, 'title'), note: optStr(spec, 'note'), label, W, H, inner });
}

// ---------------------------------------------------------------- flow (grid-placed boxes, orthogonal arrows)

type Side = 'top' | 'right' | 'bottom' | 'left';
const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];

interface FNode {
  id: string;
  label: string;
  sub?: string;
  col: number;
  row: number;
  span: number;
  kind: string;
  lines: string[];
  subLines: string[];
  w: number;
  h: number;
  x: number;
  cy: number;
}

function flow(spec: Obj): string {
  const cellW = optNum(spec, 'cellW') ?? 190;
  const gapX = optNum(spec, 'gapX') ?? 36;
  const gapY = optNum(spec, 'gapY') ?? 34;
  const pad = 12;
  const rawNodes = arr(spec, 'nodes', 2, 40);
  const ids = new Set<string>();
  const nodes: FNode[] = rawNodes.map((n, i) => {
    const id = reqStr(n, 'id', `nodes[${i}]`, 30);
    if (ids.has(id)) throw new Error(`duplicate node id "${id}"`);
    ids.add(id);
    const col = reqNum(n, 'col', id);
    const row = reqNum(n, 'row', id);
    const span = optNum(n, 'span') ?? 1;
    if (col < 0 || row < 0 || span < 1 || !Number.isInteger(col) || !Number.isInteger(row) || !Number.isInteger(span)) throw new Error(`${id}: bad grid position`);
    const kind = optStr(n, 'kind', 20) ?? 'step';
    const w = span * cellW + (span - 1) * gapX;
    const hex = kind === 'decision';
    const usable = w - (hex ? 46 : 22);
    const label = reqStr(n, 'label', id);
    const sub = optStr(n, 'sub');
    const lines = wrap(label, usable, 13);
    const subLines = sub ? wrap(sub, usable, 11) : [];
    const h = Math.max(44, lines.length * 16 + subLines.length * 14 + 20);
    return { id, label, sub, col, row, span, kind, lines, subLines, w, h, x: pad + col * (cellW + gapX), cy: 0 };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = arr(spec, 'edges', 1, 60).map((e, i) => {
    const from = byId.get(reqStr(e, 'from', `edges[${i}]`, 30));
    const to = byId.get(reqStr(e, 'to', `edges[${i}]`, 30));
    if (!from || !to) throw new Error(`edges[${i}]: unknown node`);
    const exit = optStr(e, 'exit', 8) as Side | undefined;
    const enter = optStr(e, 'enter', 8) as Side | undefined;
    if ((exit && !SIDES.includes(exit)) || (enter && !SIDES.includes(enter))) throw new Error(`edges[${i}]: bad side`);
    return { from, to, exit, enter, label: optStr(e, 'label', 60), dashed: e.dashed === true };
  });
  const groups = Array.isArray(spec.groups)
    ? arr(spec, 'groups', 0, 6).map((g, i) => ({
        label: reqStr(g, 'label', `groups[${i}]`, 40),
        nodes: ((g.nodes as unknown[]) ?? []).map((id) => {
          const n = byId.get(String(id));
          if (!n) throw new Error(`groups[${i}]: unknown node "${String(id)}"`);
          return n;
        }),
      }))
    : [];
  const rowsN = Math.max(...nodes.map((n) => n.row)) + 1;
  const colsN = Math.max(...nodes.map((n) => n.col + n.span));
  const rowH: number[] = Array.from({ length: rowsN }, () => 44);
  for (const n of nodes) rowH[n.row] = Math.max(rowH[n.row], n.h);
  const loopTop = edges.some((e) => e.exit === 'top' && e.enter === 'top');
  const loopBottom = edges.some((e) => (e.exit ?? 'bottom') === 'bottom' && e.enter === 'bottom');
  const upBack = edges.some((e) => !e.exit && !e.enter && e.to.row < e.from.row);
  const topM = pad + (groups.length ? 28 : 0) + (loopTop ? 30 : 0);
  const rowTop: number[] = [];
  let y = topM;
  for (let r = 0; r < rowsN; r++) {
    rowTop.push(y);
    y += rowH[r] + gapY;
  }
  const bodyBottom = y - gapY;
  for (const n of nodes) n.cy = rowTop[n.row] + rowH[n.row] / 2;
  const bottomM = pad + (groups.length ? 14 : 0) + (loopBottom || upBack ? 30 : 0);
  const W = pad * 2 + colsN * cellW + (colsN - 1) * gapX;
  const H = bodyBottom + bottomM;
  const topEdge = (n: FNode): number => n.cy - n.h / 2;
  const botEdge = (n: FNode): number => n.cy + n.h / 2;
  const pt = (n: FNode, s: Side): [number, number] =>
    s === 'left' ? [n.x, n.cy] : s === 'right' ? [n.x + n.w, n.cy] : s === 'top' ? [n.x + n.w / 2, topEdge(n)] : [n.x + n.w / 2, botEdge(n)];

  let inner = '';
  for (const g of groups) {
    const x0 = Math.min(...g.nodes.map((n) => n.x)) - 10;
    const x1 = Math.max(...g.nodes.map((n) => n.x + n.w)) + 10;
    const y0 = Math.min(...g.nodes.map(topEdge)) - 28;
    const y1 = Math.max(...g.nodes.map(botEdge)) + 12;
    inner += `<rect class="viz-group" x="${f(x0)}" y="${f(y0)}" width="${f(x1 - x0)}" height="${f(y1 - y0)}" rx="10"/>`;
    inner += `<text class="viz-group-label" x="${f(x0 + 12)}" y="${f(y0 + 15)}">${esc(g.label.toUpperCase())}</text>`;
  }

  let edgeSvg = '';
  let labelSvg = '';
  for (const e of edges) {
    const { from, to } = e;
    let exit = e.exit;
    let enter = e.enter;
    if (!exit && !enter) {
      if (to.row > from.row) [exit, enter] = ['bottom', 'top'];
      else if (to.row === from.row) [exit, enter] = to.col >= from.col ? ['right', 'left'] : ['left', 'right'];
      else [exit, enter] = ['bottom', 'bottom'];
    }
    exit ??= 'bottom';
    enter ??= 'top';
    const S = pt(from, exit);
    const E = pt(to, enter);
    const vert = (s: Side): boolean => s === 'top' || s === 'bottom';
    let pts: [number, number][];
    let uRoute = false;
    if (vert(exit) && vert(enter)) {
      if (exit === enter) {
        uRoute = true;
        const Y = exit === 'bottom' ? bodyBottom + 16 : topM - 18;
        pts = [S, [S[0], Y], [E[0], Y], E];
      } else if (Math.abs(S[0] - E[0]) < 1) pts = [S, E];
      else {
        const mid = exit === 'bottom' ? Math.min(S[1] + gapY / 2, (S[1] + E[1]) / 2) : Math.max(S[1] - gapY / 2, (S[1] + E[1]) / 2);
        pts = [S, [S[0], mid], [E[0], mid], E];
      }
    } else if (!vert(exit) && !vert(enter)) {
      if (Math.abs(S[1] - E[1]) < 1) pts = [S, E];
      else {
        const mid = (S[0] + E[0]) / 2;
        pts = [S, [mid, S[1]], [mid, E[1]], E];
      }
    } else if (vert(exit)) pts = [S, [S[0], E[1]], E];
    else pts = [S, [E[0], S[1]], E];
    edgeSvg += `<polyline class="viz-edge${e.dashed ? ' viz-dash' : ''}" fill="none" points="${pts.map((p) => `${f(p[0])},${f(p[1])}`).join(' ')}"/>`;
    // arrowhead
    const [p0, p1] = [pts[pts.length - 2], pts[pts.length - 1]];
    const dx = Math.sign(p1[0] - p0[0]);
    const dy = Math.sign(p1[1] - p0[1]);
    const ax = p1[0];
    const ay = p1[1];
    const head = dx
      ? `${f(ax)},${f(ay)} ${f(ax - dx * 8)},${f(ay - 4.5)} ${f(ax - dx * 8)},${f(ay + 4.5)}`
      : `${f(ax)},${f(ay)} ${f(ax - 4.5)},${f(ay - dy * 8)} ${f(ax + 4.5)},${f(ay - dy * 8)}`;
    edgeSvg += `<polygon class="viz-arrow" points="${head}"/>`;
    if (e.label) {
      if (uRoute) {
        const lx = (pts[1][0] + pts[2][0]) / 2;
        const ly = pts[1][1] + (exit === 'bottom' ? 14 : -7);
        labelSvg += `<text class="viz-edge-label" x="${f(lx)}" y="${f(ly)}" text-anchor="middle">${esc(e.label)}</text>`;
      } else {
        const a = pts[0];
        const b = pts[1];
        if (a[0] === b[0]) labelSvg += `<text class="viz-edge-label" x="${f(a[0] + 7)}" y="${f(a[1] + (b[1] > a[1] ? 16 : -8))}">${esc(e.label)}</text>`;
        else labelSvg += `<text class="viz-edge-label" x="${f((a[0] + b[0]) / 2)}" y="${f(a[1] - 7)}" text-anchor="middle">${esc(e.label)}</text>`;
      }
    }
  }
  inner += edgeSvg;

  for (const n of nodes) {
    const y0 = topEdge(n);
    const cls = `viz-node viz-node-${n.kind.replace(/[^a-z-]/g, '')}`;
    if (n.kind === 'decision') {
      const k = 16;
      const pts = [
        [n.x + k, y0],
        [n.x + n.w - k, y0],
        [n.x + n.w, n.cy],
        [n.x + n.w - k, y0 + n.h],
        [n.x + k, y0 + n.h],
        [n.x, n.cy],
      ]
        .map((p) => `${f(p[0])},${f(p[1])}`)
        .join(' ');
      inner += `<polygon class="${cls}" points="${pts}"/>`;
    } else inner += `<rect class="${cls}" x="${f(n.x)}" y="${f(y0)}" width="${f(n.w)}" height="${f(n.h)}" rx="8"/>`;
    const total = n.lines.length * 16 + n.subLines.length * 14;
    const ty = n.cy - total / 2;
    const cx = n.x + n.w / 2;
    n.lines.forEach((l, i) => (inner += `<text class="viz-node-text" x="${f(cx)}" y="${f(ty + i * 16 + 8)}" text-anchor="middle" dominant-baseline="central">${esc(l)}</text>`));
    n.subLines.forEach((l, i) => (inner += `<text class="viz-node-sub" x="${f(cx)}" y="${f(ty + n.lines.length * 16 + i * 14 + 7)}" text-anchor="middle" dominant-baseline="central">${esc(l)}</text>`));
  }
  inner += labelSvg;
  const label = `${spec.title ?? 'Flow'}: ` + nodes.map((n) => n.label).join(' → ');
  return figure({ kind: 'flow', title: optStr(spec, 'title'), note: optStr(spec, 'note'), label, W, H, inner });
}

// ---------------------------------------------------------------- entry point

const RENDERERS: Record<string, (spec: Obj) => string> = { bar, stacked, funnel, circles, line, scatter, flow };

/** Parses the JSON body of a ```viz block and returns the figure HTML. Throws with a readable message. */
export function renderViz(source: string): string {
  if (source.length > 20000) throw new Error('viz block too large');
  let spec: unknown;
  try {
    spec = JSON.parse(source);
  } catch (e) {
    throw new Error(`invalid JSON (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!isObj(spec)) throw new Error('viz spec must be an object');
  const type = spec.type;
  const render = typeof type === 'string' ? RENDERERS[type] : undefined;
  if (!render) throw new Error(`unknown viz type "${String(type)}" (use ${Object.keys(RENDERERS).join(', ')})`);
  return render(spec);
}

/** All the display strings of a spec (for the content test that checks every number comes from the report text). */
export function vizTexts(source: string): string[] {
  const out: string[] = [];
  const walk = (v: unknown, key: string): void => {
    if (typeof v === 'string' && ['display', 'displays', 'value', 'total', 'sub', 'label', 'x'].includes(key)) out.push(v);
    else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (isObj(v)) Object.entries(v).forEach(([k, x]) => walk(x, k));
  };
  walk(JSON.parse(source), '');
  return out;
}
