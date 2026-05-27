# AGENTS.md - SALSAV Live-Page Static Direct-Pantry CMS

## Repository Context

Project root:

```txt
C:\HELLOWORLD\salsav_codex
```

This is a static SALSAV Agrivoltaics website hosted from GitHub through Netlify as static hosting only.

There is no backend, no Netlify Functions, no `/api` route, no server-side secret storage, no environment-variable setup, no Supabase, and no external auth provider. Do not add backend code.

The owner explicitly accepts direct browser-to-Pantry mode. Pantry access and the Pantry ID are visible in frontend code by design. Do not call this secure. It is owner-accepted direct static Pantry editing with a convenience admin gate.

## Primary Rule

Editing happens directly on the live public pages.

Do not redirect collection editing to admin hash routes. Do not make `/admin.html` the primary editing surface for articles, team members, drag/drop, rich text, resizing, or layout changes.

`admin.html` is only for login/session status, help, opening the live site, optional seed import/reset, export, audit viewing, and logout.

## Pantry

Pantry ID:

```txt
136e2b22-0c32-409e-89dd-fef216c8b94d
```

Baskets:

```txt
salsav_site_content
salsav_site_settings
salsav_admin_audit
salsav_drafts
salsav_admin_auth
```

All content, collections, generic block order, and layout overrides live in `salsav_site_content`.

## Public Runtime Files

Public pages load:

```html
<script defer src="js/cms-config.js"></script>
<script defer src="js/cms-pantry.js"></script>
<script defer src="js/cms-core.js"></script>
<script defer src="js/cms-live-layout.js"></script>
<script defer src="js/cms-editor.js"></script>
```

The migration script must inject these idempotently and exactly once.

## Toolbar Modes

The floating live editor toolbar is the main editor surface. It must include:

```txt
Text
Move
Resize
Blocks
Preview
Refresh
Export JSON
Logout
```

Context buttons:

* `+ Article` on `news.html`
* `+ Team Member` on `team.html`

These buttons open live in-page drawers/modals. They must not link to `admin.html`.

## Text Mode

Clicking editable copy opens a lightweight Quill 2 rich text editor, lazy-loaded from CDN only for logged-in admins. Do not build a dashboard-only editor or custom `contenteditable` command system for live rich text.

Allowed rich tags:

```txt
a
strong
b
em
i
u
br
span
sup
sub
small
p
ul
ol
li
blockquote
```

Allowed attributes:

```txt
href
target
rel
class
```

Allowed classes:

```txt
cms-accent
cms-muted
cms-highlight
cms-small
cms-bold
cms-italic
```

Strip scripts, styles, iframes, objects, embeds, forms, inputs, buttons inside rich text, event handlers, and unsafe URLs. Sanitize before saving and rendering.

Save rich text fields as `type: "html"` when formatting is used and `type: "text"` otherwise.

## Move Mode

Move mode uses native live drag/drop on public pages.

Rules:

1. Drag starts only from `.salsav-cms-drag-handle-live`.
2. Do not drag from edit/delete buttons.
3. Show selected frames and drop indicators.
4. Do not save while hovering.
5. On drop, update DOM order, update Pantry model, normalize order to `10, 20, 30...`, save once, and append audit.
6. If save fails, show an error and reload/re-hydrate from Pantry.
7. Provide Move Up / Move Down controls in Blocks mode for keyboard/mobile fallback.

## Resize Mode

Resize mode adds live resize handles to block-level elements only:

```txt
right
bottom
bottom-right
```

Eligible targets include news cards, team cards, site cards, education cards, research cards, partner/logos, safe hero panels, image wrappers, video wrappers, chart cards, and repeated generic blocks.

Do not resize tiny inline text spans.

Layout overrides are stored in:

```json
{
  "layout": {
    "pages": {
      "pageId": {
        "blocks": {
          "blockId": {
            "width": "340px",
            "minHeight": "420px",
            "imageHeight": "210px",
            "updatedAt": null
          }
        }
      }
    }
  }
}
```

Clamp sizes, avoid absolute coordinates, do not break responsive grids, and provide reset size/page layout paths when practical.

## Blocks Mode

Blocks mode shows live action bubbles for eligible blocks:

```txt
Edit
Duplicate
Archive
Delete
Move Up
Move Down
Move To Section
```

News and team blocks have structured edit drawers. Generic blocks support order, visibility/archive, layout, and safe local block actions.

## Content Schema

Preserve existing `pages` fields and unknown top-level fields.

Top-level shape:

```json
{
  "version": 1,
  "updatedAt": null,
  "pages": {},
  "collections": {
    "newsArticles": [],
    "teamSections": [],
    "teamMembers": [],
    "teamSummaryRows": [],
    "genericBlocks": {}
  },
  "layout": {
    "pages": {}
  }
}
```

## News Live Editing

`news.html` uses `#news-grid-container`.

Live support:

* add article
* edit article
* duplicate article
* archive/remove article
* drag/drop reorder
* resize cards
* edit title, category, source, date, display date, description, URL, image path/URL, image alt

Use `collections.newsArticles`. Allowed categories are `article`, `paper`, and `video`. Preserve the existing filter UI and rebind filters after dynamic rendering. If Pantry fails or the collection is empty, keep static fallback cards.

## Team Live Editing

`team.html` uses `.pi-profile`, `.team-grid`, `.researcher-card`, and `.project-table`.

Live support:

* add team member
* edit team member
* duplicate team member
* archive/remove team member
* drag/drop reorder
* drag/drop move between sections
* resize cards
* edit member fields
* toggle include in Team Summary

Sections:

```txt
principal_investigator
key_contributors
alumni
team_summary
```

Team Summary renders from visible members with `includeInSummary === true` plus visible manual rows. If Pantry fails or the collection is empty, keep static fallback content.

## Generic Blocks

`tools/prepare-cms.mjs` annotates repeatable containers with:

```html
data-cms-list="..."
data-cms-list-type="genericBlocks"
```

and child blocks with:

```html
data-cms-block-id="..."
data-cms-block-type="genericBlock"
```

Generic order and visibility live in:

```json
{
  "collections": {
    "genericBlocks": {
      "pageId.listId": [
        {
          "id": "page_section_block_1",
          "visible": true,
          "order": 10,
          "sourceCmsKeys": [],
          "updatedAt": null
        }
      ]
    }
  }
}
```

## Migration Rules

Run:

```bash
node tools/prepare-cms.mjs
```

The script must:

* scan only public HTML pages
* preserve static fallback content
* preserve inline scripts/styles/chart data/SVG paths
* add CMS scripts and CSS once
* add `data-cms-page`
* add `data-cms-key` and safe attribute keys
* add `data-cms-list` and `data-cms-block-id`
* extract news/team collections
* seed `collections.genericBlocks`
* seed `layout.pages`
* be idempotent

## Audit Events

Append live editor audit events such as:

```txt
rich_text_updated
text_updated
block_created
block_archived
block_deleted
block_duplicated
block_reordered
block_resized
block_moved_section
layout_reset
page_layout_reset
news_article_created
news_article_updated
team_member_created
team_member_updated
```

Event shape:

```json
{
  "type": "block_reordered",
  "entityType": "newsArticle",
  "entityId": "news_...",
  "label": "Human readable label",
  "pageId": "news",
  "at": "ISO timestamp",
  "source": "live-editor"
}
```

## Do Not Break

Do not remove:

* existing login
* existing Pantry config
* existing static fallback content
* existing CMS keys
* existing copy hydration
* existing article filters
* existing team page classes
* existing CSS
* existing inline page scripts
* existing assets

Do not create:

```txt
netlify/functions/
api/
server/
.env
```
