---
name: salsav-dashboard-ui
description: "Use when a SALSAV dashboard chip, lane tab, twisty or filter dropdown looks unstyled, shows no on/off state, or differs between the branch and the live site."
category: design
status: active
author: reflect
created: 2026-11-12
---
For SALSAV dashboard state or styling bugs, read the live DOM and computed styles before editing CSS.
- In dashboard.html, the el() helper must get aria booleans as strings: pass String(v) for aria-* keys. A bare false is dropped and true becomes an empty value, so [aria-pressed="true"] never matches.
- Reproduce on the live page with JS that prints getAttribute and getComputedStyle for each element; a screenshot alone does not show the cause.
- Native select: set appearance:none and draw the chevron with a background gradient, since Opera and Edge otherwise box the control.
- Build legend and count chips from the same layout function the chart uses, so the counts match.
- A legend chip that toggles a layer is a button with aria-pressed; its flag gates that layer's data (S.uv) and persists as an inverted store key (hideUv='1' means off), so the default needs no migration.
- Local check: serve the repo, fetch each changed file with cache:'reload', then reload(); the browser otherwise serves old JS.
- Run dash/viz.test.mjs, dash/collection.test.mjs and dashboard.test.mjs before committing.
- A JS run that calls location.reload or navigate is cut off; check the tab URL before re-running it.
- After a push, poll for a marker only the new build has. For CSS, poll https://salsav.org/dashboard.css for a new class name. For a dashboard.html-only change, fetch https://salsav.org/dashboard with cache:'no-store' until it contains a new JS string, then reload; a CSS poll proves nothing there. Netlify took about 20s.
- Test at 1620x900, then reset the viewport to desktop.
- Commit to the work branch; push to main only when the repo's AGENTS.md or CLAUDE.md grants standing permission.
