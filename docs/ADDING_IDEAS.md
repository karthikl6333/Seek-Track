# Adding a report to the Ideas tab

Reports are Markdown files in `src/content/ideas/`. Add a file, rebuild, done. No database, no API.

## 1. Create the file

`src/content/ideas/<slug>.md`. The file name (lowercase letters, digits, dashes) is the slug and the
deep link: `https://seek-track.pages.dev/#ideas/<slug>`.

```markdown
---
title: "Boosted Breeding in Agriculture: Global Landscape"
date: 2026-10-31
summary: "One or two sentences shown on the list card."
tags: [Agriculture, India, Investing]
source: https://example.com/where-this-came-from
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
| `source` | no | `http(s)` URL, shown as "Original source" on the report. |

A file with a missing or malformed field is hidden and a warning listing it appears at the top of the
Ideas tab. `npx vitest run` also fails (`src/content/ideas/content.test.ts`).

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

Put files under `src/content/ideas/assets/<slug>/` (jpg, png, webp, gif, svg; keep each well under
200 KB, resize and compress first) and reference them relative to `src/content/ideas/`:

```markdown
![Hong Kong skyline](assets/<slug>/cover.jpg)
```

Vite fingerprints and serves them from `/assets/`. A path that does not exist renders as its alt text, and
the content test fails. Remote images (`https://...`) also work; credit the source in the caption.
Images are lazy-loaded and never wider than the page.

## 4. Check and ship

```bash
npx vitest run        # content + renderer tests
npm run build:cf      # same build the deploy uses
```

Open `#ideas` locally (`npm run dev:client`) to check the card and the report. Commit the `.md` file
and its assets, then deploy as usual.

Do not put reports under a `/reports` URL or static folder: the production deploy returns 404 for `/reports/*`.
