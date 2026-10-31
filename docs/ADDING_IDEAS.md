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
- **Wide tables** scroll sideways inside the page. Charts: write them as a table of values.
- Use `##` for the first heading level; the title comes from the frontmatter, so do not repeat it as `#`.
- Raw HTML is sanitized (DOMPurify): scripts, iframes, forms, inline styles and event handlers are removed.

## 3. Images

Put files under `content/ideas/assets/<slug>/` (jpg, png, webp, gif; no svg; keep each well under
200 KB, resize and compress first) and reference them relative to `content/ideas/`:

```markdown
![Hong Kong skyline](assets/<slug>/cover.jpg)
```

The reader rewrites the reference to the authed `/api/ideas/<slug>/img/<file>`; images are never inlined as
base64. A path that does not exist renders as its alt text, and the content test fails. Remote images (`https://...`) also work; credit the source in the caption.
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
