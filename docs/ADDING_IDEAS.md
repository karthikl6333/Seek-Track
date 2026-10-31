# Adding a report to the Ideas tab

Reports are Markdown files in `content/ideas/` (repo root). Add a file, rebuild, done. No database.

**Privacy:** reports are served only by the authed `/api/ideas` routes and are embedded in the server
bundle, never in the public static files. Do **not** put them under `src/` or `public/`: Vite would
bundle them into `/assets/*`, which is public on prod. `npm run build:cf` runs a guard that fails if any
report text or image reaches the static output.

## 1. Create the file

`content/ideas/<slug>.md`. The file name (lowercase letters, digits, dashes) is the slug and the
deep link: `https://seek-track.pages.dev/#ideas/<slug>`.

```markdown
---
title: "Boosted Breeding in Agriculture: Global Landscape"
date: 2026-10-31
summary: "One or two sentences shown on the list card."
tags: [Agriculture, India, Investing]
---

## First section

Body text in Markdown.
```

| Field | Required | Notes |
|-------|----------|-------|
| `title` | yes | Quote it if it contains a colon. |
| `date` | yes | `YYYY-MM-DD`. The list is newest first. |
| `summary` | yes | Plain text, 1-2 sentences. |
| `tags` | no | `[A, B]` or a `- A` list. They become the filter chips (case-insensitive, duplicates merged). |

A file with a missing or malformed field is hidden and a warning listing it appears at the top of the
Ideas tab and `build:cf` fails. `npx vitest run` also fails (`server/ideas/store.test.ts`). Unknown frontmatter
keys (such as an old `source:` link) are ignored; do not add links back to where a private report came from.

## 2. What the reader renders

GitHub-flavoured Markdown: `##`/`###`/`####` headings (the `##` ones become a contents list when there
are three or more), paragraphs, bold/italic, lists, task lists (`* [ ] item`), tables, code, links
(always open in a new tab), images and blockquotes.

- **Callouts:** any blockquote is a callout. `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`,
  `> [!WARNING]` or `> [!CAUTION]` on the first line adds a titled, coloured one.
- **Wide tables** scroll sideways inside the page. Charts and flowcharts: see section 2A; keep the table of values next to the chart.
- Use `##` for the first heading level; the title comes from the frontmatter, so do not repeat it as `#`.
- Raw HTML is sanitized (DOMPurify): scripts, iframes, forms, inline styles and event handlers are removed.

## 2A. Charts, funnels and flowcharts (```` ```viz ````)

A fenced block with the language `viz` holds a JSON spec and is drawn as inline SVG: no script, no CDN, no
inline styles, so it works under the app's CSP and auth, and it follows the dark and seasonal theme (colors
come from CSS variables). A bad spec shows a visible "Chart error" box instead of breaking the report, and
the content test (`src/pages/ideas/viz.test.ts`) fails on it.

Rules for the content:

- **Only numbers that are in the report's text.** The test checks that every number shown in a chart also
  appears outside the chart blocks. Never add a figure only in a chart.
- **Keep the table.** The chart goes above the table it visualises; the table stays as the exact record.
- **Label estimates** with `"estimate": true` (dashed outline, hollow dot) and say so in `note`/`display`.
- A `note` is the caption under the chart; `title` the heading. Both are plain text.

Every spec needs `"type"`:

| type | shape |
|---|---|
| `bar` | `items: [{label, value, display, estimate?}]`, optional `max`. Grouped: `series: ["A","B"]` and per item `values: [..]`, `displays: [..]`, `estimates: [..]`. |
| `stacked` | `rows: [{label, total?, parts: [{label, value, display}]}]`, optional `normalize: false` plus `max` to compare absolute totals. |
| `funnel` | `columns: [{heading, levels: [{tag, value, label, status?, estimate?}]}]` (1 to 3 columns, up to 5 levels). For TAM, SAM, SOM: `status` says Sourced, Computed or Estimate. Funnels are "not to scale". |
| `circles` | `items: [{tag, value, display, estimate?}]` (2 to 5, area proportional to `value`). |
| `line` | `points: [{x, y, display, estimate?}]`, optional `at` (numeric x position), `yMax`, `yPrefix`, `ySuffix`. |
| `scatter` | `points: [{label, x, y}]` with x and y between 0 and 1, plus `xLabel`, `yLabel`. |
| `flow` | `nodes: [{id, label, sub?, col, row, span?, kind?}]` placed on a grid (`kind`: `step`, `key`, `decision`, `good`, `muted`), `edges: [{from, to, label?, dashed?, exit?, enter?}]` (sides: `top`, `right`, `bottom`, `left`), optional `groups: [{label, nodes: [ids]}]`, `cellW`, `gapX`, `gapY`. Edges are routed at right angles. |

Charts scroll sideways inside the page rather than shrinking below a readable size on a phone.

## 3. Images

Put files under `content/ideas/assets/<slug>/` (webp preferred, also jpg, png, gif; no svg; resize and compress first, about 1280 px wide and 30 to 130 KB each) and reference them relative to `content/ideas/`:

```markdown
![Hong Kong skyline](assets/<slug>/cover.jpg)
```

The reader rewrites the reference to the authed `/api/ideas/<slug>/img/<file>`; images are never inlined as
base64. A report whose images total more than 64 KB (`EMBED_IMAGE_BYTES`) is not embedded in the worker: its files go to the private hashed static prefix `dist-cf/_private/ideas/<sha256>.webp`, which the worker gate never serves directly (see docs/ARCHITECTURE.md, Ideas tab). Small sets are embedded as base64. Either way the browser only ever gets them from the authed route. A path that does not exist renders as its alt text, and the content test fails. Remote images (`https://...`) also work; credit the source in the caption.
Images are lazy-loaded and never wider than the page.

## Brochure-style pages (HTML)

For a fully designed page (like the Hong Kong & Macau trip) use `format: brochure` in the frontmatter (body
stays empty, the card text comes from `title`, `date`, `summary`, `tags`) and put the page in
`content/ideas/pages/<slug>.html`:

- One self-contained file: inline `<style>` and an optional inline `<script>`; no `<iframe>`, `<form>`,
  `<base>`, `<link>`, `<object>` or `<embed>`, no remote scripts or styles. The page is served with
  `default-src 'none'; img-src 'self'; style-src/script-src 'unsafe-inline'` and shown in a sandboxed iframe
  without `allow-same-origin`, so it cannot reach the app.
- Photos as files in `content/ideas/assets/<slug>/`, referenced as `<img src="img/<file>">` (resolved to the authed
  `/api/ideas/<slug>/img/<file>`; the content test fails on a reference with no file). Use webp, about 150 KB
  or less each, and do not base64-inline anything.
- External links need `target="_blank" rel="noopener noreferrer"` (a plain link would navigate the iframe;
  the content test checks this).
- The page is embedded in the worker, the photos go to the private static prefix (see ARCHITECTURE.md, "Brochure
  reports", including the Pages "Fail closed" recommendation).

## 4. Check and ship

```bash
npx vitest run        # content, routes, renderer and leak-guard tests
npm run build:cf      # same build the deploy uses; also runs the static-output leak guard
```

Open `#ideas` locally (`npm run dev`, which runs the API too; the reports are not served by `dev:client` alone) to check the card and the report. Commit the `.md` file
and its assets, then deploy as usual.

Do not put reports under a `/reports` URL or static folder: the production deploy returns 404 for `/reports/*`.
