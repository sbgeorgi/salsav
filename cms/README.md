# SALSAV Live-Page Static Direct-Pantry CMS

This CMS uses direct static Pantry mode. It is not secure against technical users; the Pantry ID is intentionally public because the owner chose direct browser-to-Pantry editing.

`/admin.html` is only for login/session help, opening the live site, optional seed import/reset, export, audit viewing, and logout. Content editing happens directly on public pages through the floating toolbar.

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

## Login

Open `/admin.html`, log in, then click **Open live site**. The toolbar appears on public pages while the session is valid.

## Toolbar Modes

* **Text**: click editable copy and use the Quill 2 rich text editor, lazy-loaded only after admin login.
* **Move**: drag blocks from their visible handle and save order on drop.
* **Resize**: drag right, bottom, or corner handles on block-level cards.
* **Blocks**: edit, duplicate, archive, delete, move up/down, and move team members between sections.
* **Preview**: temporarily hides editor chrome.

Toolbar actions include Refresh, Export JSON, and Logout. On `news.html` the toolbar shows `+ Article`; on `team.html` it shows `+ Team Member`.

There are no dashboard redirects for article or team editing.

## Rich Text

The live page editor lazy-loads Quill 2 from CDN the first time an admin opens Text mode editing. It supports bold, italic, underline, links, unlink, superscript, subscript, lists, clear formatting, and safe styling classes:

```txt
cms-accent
cms-muted
cms-highlight
cms-small
cms-bold
cms-italic
```

Rich HTML is sanitized before saving and before rendering.

## Collections

Structured content is stored in `salsav_site_content.collections`:

```json
{
  "newsArticles": [],
  "teamSections": [],
  "teamMembers": [],
  "teamSummaryRows": [],
  "genericBlocks": {}
}
```

Layout overrides are stored in:

```json
{
  "layout": {
    "pages": {}
  }
}
```

## News Live Editing

Open `news.html` after login. Use `+ Article` to add an article. Use Blocks mode to edit, duplicate, archive, delete, move up/down, or reorder existing article cards. Use Resize mode to resize cards.

Image upload is not included. Image fields are text paths or URLs. Missing images fall back to `static/salsa-logo.png`.

If Pantry fails or the collection is empty, the static fallback cards remain.

## Team Live Editing

Open `team.html` after login. Use `+ Team Member` to add a person. Use Blocks mode to edit, duplicate, archive, delete, move up/down, or move a member between Principal Investigator, Key Contributors, SALSA Alumni, and Team Summary. Use Resize mode for cards.

Team Summary renders from members with `includeInSummary: true` plus manual summary rows.

## Generic Blocks

The migration script annotates repeated lists and blocks across public pages. Generic blocks can be reordered and resized where annotated. Static HTML remains the fallback template.

## Migration

Run:

```bash
node tools/prepare-cms.mjs
```

The script is idempotent. It injects CMS files once, preserves fallback content, extracts news/team seed collections, and creates generic block/layout seed data.

## Recovery

Use `/admin.html` to import `cms/seed-content.json` if Pantry content becomes malformed. For broken layout, reset or remove the relevant `layout.pages[pageId].blocks` entries in JSON, then save/import again.

## Troubleshooting

If the toolbar does not appear:

* Log in again at `/admin.html`.
* Confirm the session has not expired.
* Confirm public pages include `js/cms-config.js`, `js/cms-pantry.js`, `js/cms-core.js`, `js/cms-live-layout.js`, and `js/cms-editor.js`.

If dynamic news/team rendering fails:

* Confirm `collections.newsArticles`, `collections.teamSections`, `collections.teamMembers`, and `collections.teamSummaryRows` are arrays.
* Confirm image paths are `http`, `https`, or relative paths.
* Re-import the seed content if needed.
